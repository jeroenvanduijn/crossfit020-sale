// ============================================
// GOOGLE APPS SCRIPT - CrossFit 020 Uitverkoop
// ============================================
//
// INSTALLATIE:
// 1. Open je Google Sheet: https://docs.google.com/spreadsheets/d/1io_7NhEUSwB-Gj8KPJ58wUqh_AYhzJZh6nxxUpEGIGU
// 2. Ga naar: Extensies → Apps Script
// 3. Verwijder alle code en plak dit script
// 4. Klik op "Opslaan" (💾)
// 5. Klik op "Implementeren" → "Nieuwe implementatie"
// 6. Type: "Web-app"
// 7. Uitvoeren als: "Ikzelf"
// 8. Toegang: "Iedereen"
// 9. Klik "Implementeren" en kopieer de URL
// 10. Plak de URL in de website (SCRIPT_URL variabele)
//
// BELANGRIJK: Kolom "Origineel" bevat de originele voorraad.
// Beschikbare voorraad = Origineel - alle bestelde aantallen
// Als je een bestelling verwijdert, gaat de voorraad automatisch omhoog!
//
// ============================================

const INVENTORY_SHEET = "Sheet1";  // Naam van je inventaris tabblad
const ORDERS_SHEET = "Bestellingen";  // Tabblad voor bestellingen
const ZAPIER_WEBHOOK_URL = "https://hooks.zapier.com/hooks/catch/2231753/uafctk7/";

// GET request - Inventaris ophalen
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(INVENTORY_SHEET);
    const data = sheet.getDataRange().getValues();

    // Headers van je sheet
    const headers = data[0];

    // Vind de juiste kolom indices
    const matCol = findColumn(headers, "Materiaal");
    const weightCol = findColumn(headers, "Gewicht");
    const priceCol = findColumn(headers, "2de hands prijs");
    const origCol = findColumn(headers, "Origineel");

    if (origCol === -1) {
      return ContentService
        .createTextOutput(JSON.stringify({
          success: false,
          error: "Kolom 'Origineel' niet gevonden. Voeg deze kolom toe aan je sheet."
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Haal alle bestelde aantallen op per rij
    const orderedQuantities = getOrderedQuantitiesByRow(ss);

    const inventory = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const materiaal = row[matCol];
      const gewicht = row[weightCol];
      const origineel = row[origCol];
      const prijs = row[priceCol];

      // Skip lege rijen, totaalrijen, en items zonder originele voorraad of prijs
      if (!materiaal ||
          materiaal === "TOTAAL" ||
          String(materiaal).toLowerCase().includes("totaal") ||
          String(gewicht).toLowerCase() === "totaal" ||
          origineel === null ||
          origineel === "" ||
          isNaN(origineel) ||
          prijs === null ||
          prijs === "" ||
          isNaN(prijs)) {
        continue;
      }

      const rowIndex = i + 1; // 1-based row number in sheet

      // Bereken beschikbare voorraad: Origineel - besteld
      const origineelAantal = parseInt(origineel) || 0;
      const besteldAantal = orderedQuantities[rowIndex] || 0;
      const beschikbaar = Math.max(0, origineelAantal - besteldAantal);

      // Genereer een unieke ID
      const id = generateId(materiaal, gewicht, i);

      inventory.push({
        id: id,
        rowIndex: rowIndex,
        name: cleanName(materiaal),
        weight: gewicht && gewicht !== "" && !isNaN(gewicht) ? String(gewicht) + "kg" : null,
        quantity: beschikbaar,
        originalQuantity: origineelAantal,
        orderedQuantity: besteldAantal,
        price: parseFloat(prijs) || 0,
        category: getCategory(materiaal)
      });
    }

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        inventory: inventory,
        timestamp: new Date().toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Haal alle bestelde aantallen op, gegroepeerd per rij-index
function getOrderedQuantitiesByRow(ss) {
  const ordersSheet = ss.getSheetByName(ORDERS_SHEET);
  const quantities = {};

  if (!ordersSheet) {
    return quantities; // Geen bestellingen sheet = geen bestellingen
  }

  const ordersData = ordersSheet.getDataRange().getValues();

  // Zoek de "Items" kolom in bestellingen (bevat "2x Dumbell 20kg, 1x Kettlebell 16kg")
  const ordersHeaders = ordersData[0];
  let itemsCol = -1;
  for (let c = 0; c < ordersHeaders.length; c++) {
    if (String(ordersHeaders[c]).toLowerCase().trim() === "items") {
      itemsCol = c;
      break;
    }
  }

  if (itemsCol === -1) {
    // Fallback: kolom J (index 9) is de standaard Items kolom
    itemsCol = 9;
  }

  // We hebben ook de rowIndex nodig, die slaan we op in een aparte kolom
  // Maar die hebben we niet... We moeten de items matchen op naam+gewicht

  // Eerst: haal inventaris data op voor matching
  const invSheet = ss.getSheetByName(INVENTORY_SHEET);
  const invData = invSheet.getDataRange().getValues();
  const invHeaders = invData[0];

  const matCol = findColumn(invHeaders, "Materiaal");
  const weightCol = findColumn(invHeaders, "Gewicht");

  // Maak een lookup: "naam gewicht" -> rowIndex
  const itemLookup = {};
  for (let i = 1; i < invData.length; i++) {
    const mat = cleanName(String(invData[i][matCol] || "").trim());
    const weight = invData[i][weightCol];
    const weightStr = weight && weight !== "" && !isNaN(weight) ? weight + "kg" : "";
    const key = (mat + " " + weightStr).trim().toLowerCase();
    itemLookup[key] = i + 1; // rowIndex (1-based)

    // Ook zonder "kg" suffix
    const key2 = (mat + " " + (weight || "")).trim().toLowerCase();
    if (key2 !== key) {
      itemLookup[key2] = i + 1;
    }

    // Ook alleen naam (voor items zonder gewicht)
    if (!weightStr) {
      itemLookup[mat.toLowerCase()] = i + 1;
    }
  }

  // Parse alle bestellingen en tel aantallen per item
  for (let r = 1; r < ordersData.length; r++) {
    const itemsStr = String(ordersData[r][itemsCol] || "");

    // Parse "2x Dumbell 20kg, 1x Kettlebell 16kg"
    const items = itemsStr.split(",");

    for (const item of items) {
      const trimmed = item.trim();
      if (!trimmed) continue;

      // Match "2x Naam Gewicht" pattern
      const match = trimmed.match(/^(\d+)x\s+(.+)$/i);
      if (match) {
        const qty = parseInt(match[1]);
        const itemName = match[2].trim().toLowerCase();

        // Zoek rowIndex via lookup
        const rowIndex = itemLookup[itemName];
        if (rowIndex) {
          quantities[rowIndex] = (quantities[rowIndex] || 0) + qty;
        }
      }
    }
  }

  return quantities;
}

// POST request - Bestelling plaatsen
function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Parse data - werkt met zowel application/json als text/plain
    let data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseError) {
      // Probeer als text/plain
      data = JSON.parse(e.parameter.data || e.postData.contents);
    }

    // Maak bestellingen-sheet als die niet bestaat
    let ordersSheet = ss.getSheetByName(ORDERS_SHEET);
    if (!ordersSheet) {
      ordersSheet = ss.insertSheet(ORDERS_SHEET);
      ordersSheet.appendRow([
        "OrderID",
        "Datum",
        "Tijd",
        "Naam",
        "Email",
        "Telefoon",
        "Ophaalmoment",
        "Transport",
        "Opmerkingen",
        "Items",
        "Totaal",
        "Status"
      ]);
      // Maak header vet
      ordersSheet.getRange(1, 1, 1, 12).setFontWeight("bold");
    }

    // Genereer order ID
    const orderId = "ORD-" + Date.now();
    const now = new Date();

    // Voeg bestelling toe
    // Items format: "2x Dumbell 20kg, 1x Kettlebell 16kg"
    ordersSheet.appendRow([
      orderId,
      now.toLocaleDateString('nl-NL'),
      now.toLocaleTimeString('nl-NL'),
      data.customer.name,
      data.customer.email,
      data.customer.phone,
      formatPickup(data.customer.pickup),
      formatTransport(data.customer.transport),
      data.customer.notes || "",
      data.items.map(i => `${i.quantity}x ${i.name}${i.weight ? ' ' + i.weight : ''}`).join(", "),
      "€" + data.total,
      "Nieuw"
    ]);

    // GEEN voorraad update meer hier!
    // De voorraad wordt nu berekend op basis van Origineel - alle bestellingen
    // Als je een bestelling verwijdert, gaat de voorraad automatisch omhoog

    // Stuur bestelgegevens naar Zapier webhook
    try {
      const webhookPayload = {
        orderId: orderId,
        datum: now.toLocaleDateString('nl-NL'),
        tijd: now.toLocaleTimeString('nl-NL'),
        klant: {
          naam: data.customer.name,
          email: data.customer.email,
          telefoon: data.customer.phone,
          ophaalmoment: formatPickup(data.customer.pickup),
          transport: formatTransport(data.customer.transport),
          opmerkingen: data.customer.notes || ""
        },
        items: data.items.map(i => ({
          naam: i.name,
          gewicht: i.weight || null,
          aantal: i.quantity,
          prijsPerStuk: i.price,
          totaalPrijs: i.quantity * i.price
        })),
        totaal: data.total,
        itemsText: data.items.map(i => `${i.quantity}x ${i.name}${i.weight ? ' ' + i.weight : ''}`).join(", ")
      };

      UrlFetchApp.fetch(ZAPIER_WEBHOOK_URL, {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify(webhookPayload),
        muteHttpExceptions: true
      });
    } catch (webhookError) {
      // Webhook fout negeren, bestelling is al opgeslagen
      Logger.log("Webhook error: " + webhookError.message);
    }

    // Stuur email notificatie (optioneel - pas email aan)
    try {
      const emailBody = `
Nieuwe bestelling ontvangen!

Order: ${orderId}
Datum: ${now.toLocaleDateString('nl-NL')} ${now.toLocaleTimeString('nl-NL')}

Klant:
- Naam: ${data.customer.name}
- Email: ${data.customer.email}
- Telefoon: ${data.customer.phone}
- Ophaalmoment: ${formatPickup(data.customer.pickup)}
- Transport: ${formatTransport(data.customer.transport)}
- Opmerkingen: ${data.customer.notes || "-"}

Bestelling:
${data.items.map(i => `- ${i.quantity}x ${i.name}${i.weight ? ' ' + i.weight : ''} (€${i.price * i.quantity})`).join('\n')}

Totaal: €${data.total}
      `;

      // Uncomment de volgende regel en vul je email in om notificaties te ontvangen:
      // MailApp.sendEmail("jouw@email.com", "Nieuwe bestelling: " + orderId, emailBody);

    } catch (emailError) {
      // Email fout negeren, bestelling is al opgeslagen
    }

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        orderId: orderId
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Helper: vind kolom index (case-insensitive)
function findColumn(headers, name) {
  const searchName = name.toLowerCase().trim();
  for (let c = 0; c < headers.length; c++) {
    if (String(headers[c]).toLowerCase().trim() === searchName) {
      return c;
    }
  }
  return -1;
}

// Helper functies
function generateId(materiaal, gewicht, index) {
  const name = String(materiaal).toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 20);
  const weight = gewicht && !isNaN(gewicht) ? '-' + gewicht : '';
  return name + weight + '-' + index;
}

function cleanName(materiaal) {
  // Verwijder "(totaal)" en andere toevoegingen
  return String(materiaal)
    .replace(/\s*\(totaal\)\s*/gi, '')
    .replace(/\s*\(set\)\s*/gi, ' (set)')
    .trim();
}

function getCategory(materiaal) {
  const name = String(materiaal).toLowerCase();

  if (name.includes('dumbel')) return 'Dumbells';
  if (name.includes('kettlebell')) return 'Kettlebells';
  if (name.includes('bumper')) return 'Bumper Plates';
  if (name.includes('rower') || name.includes('bike') || name.includes('ski erg')) return 'Cardio';
  if (name.includes('barbell') || name.includes('bar') || name.includes('j-hook')) return 'Barbells & Bars';

  return 'Overige Apparatuur';
}

function formatPickup(pickup) {
  const pickupMap = {
    // Zondag 28 dec
    'zo-28-13': 'Zo 28 dec 13:00-14:00',
    'zo-28-14': 'Zo 28 dec 14:00-15:00',
    'zo-28-15': 'Zo 28 dec 15:00-16:00',
    'zo-28-16': 'Zo 28 dec 16:00-17:00',
    // Maandag 29 dec
    'ma-29-10': 'Ma 29 dec 10:00-11:00',
    'ma-29-13': 'Ma 29 dec 13:00-14:00',
    'ma-29-14': 'Ma 29 dec 14:00-15:00',
    'ma-29-15': 'Ma 29 dec 15:00-16:00',
    'ma-29-16': 'Ma 29 dec 16:00-17:00',
    // Dinsdag 30 dec
    'di-30-13': 'Di 30 dec 13:00-14:00',
    'di-30-14': 'Di 30 dec 14:00-15:00',
    'di-30-15': 'Di 30 dec 15:00-16:00',
    'di-30-16': 'Di 30 dec 16:00-17:00',
    'di-30-17': 'Di 30 dec 17:00-18:00',
    'di-30-18': 'Di 30 dec 18:00-19:00',
    'di-30-19': 'Di 30 dec 19:00-20:00',
    'di-30-20': 'Di 30 dec 20:00-21:00',
    // Woensdag 31 dec
    'wo-31-09': 'Wo 31 dec 09:00-10:00',
    'wo-31-10': 'Wo 31 dec 10:00-11:00',
    'wo-31-11': 'Wo 31 dec 11:00-12:00',
    'wo-31-12': 'Wo 31 dec 12:00-13:00',
    'wo-31-13': 'Wo 31 dec 13:00-14:00'
  };
  return pickupMap[pickup] || pickup;
}

function formatTransport(transport) {
  const transportMap = {
    'yes': 'Ja',
    'no': 'Nee',
    'unknown': 'Weet nog niet'
  };
  return transportMap[transport] || transport;
}

// Test functie - run deze om te checken of alles werkt
function testInventory() {
  const result = doGet({});
  const data = JSON.parse(result.getContent());
  Logger.log("Inventory items: " + data.inventory.length);
  if (data.inventory.length > 0) {
    Logger.log("Eerste 3 items:");
    data.inventory.slice(0, 3).forEach(item => {
      Logger.log(`- ${item.name} ${item.weight || ''}: ${item.quantity} beschikbaar (origineel: ${item.originalQuantity}, besteld: ${item.orderedQuantity})`);
    });
  }
}

// Test functie - check kolom headers
function testColumns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INVENTORY_SHEET);
  const headers = sheet.getRange(1, 1, 1, 10).getValues()[0];
  Logger.log("Headers: " + JSON.stringify(headers));

  const origCol = findColumn(headers, "Origineel");
  if (origCol >= 0) {
    Logger.log(">>> ORIGINEEL kolom gevonden op index " + origCol + " (kolom " + (origCol+1) + ")");
  } else {
    Logger.log("!!! ORIGINEEL kolom NIET gevonden - voeg deze toe!");
  }
}

// Test functie - bekijk bestelde aantallen per item
function testOrderedQuantities() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const quantities = getOrderedQuantitiesByRow(ss);
  Logger.log("Bestelde aantallen per rij:");
  Logger.log(JSON.stringify(quantities, null, 2));
}
