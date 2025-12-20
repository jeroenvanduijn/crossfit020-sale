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
// ============================================

const INVENTORY_SHEET = "Sheet1";  // Naam van je inventaris tabblad
const ORDERS_SHEET = "Bestellingen";  // Tabblad voor bestellingen (wordt automatisch aangemaakt)

// GET request - Inventaris ophalen
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(INVENTORY_SHEET);
    const data = sheet.getDataRange().getValues();
    
    // Headers van je sheet
    const headers = data[0];
    
    // Vind de juiste kolom indices
    const matCol = headers.indexOf("Materiaal");
    const weightCol = headers.indexOf("Gewicht");
    const qtyCol = headers.indexOf("Aantal");
    const priceCol = headers.indexOf("2de hands prijs");
    
    const inventory = [];
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const materiaal = row[matCol];
      const gewicht = row[weightCol];
      const aantal = row[qtyCol];
      const prijs = row[priceCol];
      
      // Skip lege rijen, totaalrijen, en items met 0 voorraad of geen prijs
      if (!materiaal || 
          materiaal === "TOTAAL" || 
          String(materiaal).toLowerCase().includes("totaal") ||
          String(gewicht).toLowerCase() === "totaal" ||
          aantal === null || 
          aantal === "" ||
          isNaN(aantal) ||
          prijs === null || 
          prijs === "" ||
          isNaN(prijs)) {
        continue;
      }
      
      // Genereer een unieke ID
      const id = generateId(materiaal, gewicht, i);
      
      inventory.push({
        id: id,
        rowIndex: i + 1, // 1-based row number in sheet
        name: cleanName(materiaal),
        weight: gewicht && gewicht !== "" && !isNaN(gewicht) ? String(gewicht) + "kg" : null,
        quantity: parseInt(aantal) || 0,
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
    
    // Update inventaris (verminder voorraad)
    const invSheet = ss.getSheetByName(INVENTORY_SHEET);
    const invData = invSheet.getDataRange().getValues();
    const headers = invData[0];
    const qtyCol = headers.indexOf("Aantal");
    
    data.items.forEach(item => {
      if (item.rowIndex) {
        const currentQty = invSheet.getRange(item.rowIndex, qtyCol + 1).getValue();
        const newQty = Math.max(0, currentQty - item.quantity);
        invSheet.getRange(item.rowIndex, qtyCol + 1).setValue(newQty);
      }
    });
    
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
    'za-27': 'Za 27 dec (13:00-16:00)',
    'zo-28': 'Zo 28 dec (13:00-17:00)',
    'ma-29': 'Ma 29 dec (06:00-21:00)',
    'di-30': 'Di 30 dec (06:00-21:00)',
    'wo-31': 'Wo 31 dec (08:00-13:00)'
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
  Logger.log(JSON.stringify(data.inventory.slice(0, 5), null, 2));
}
