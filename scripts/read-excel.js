import xlsx from 'xlsx';

const workbook = xlsx.readFile('DAT_Development_Plan.xlsx');
console.log('Sheets:', workbook.SheetNames);

for (const sheetName of workbook.SheetNames) {
  if (sheetName.toLowerCase().includes('roadmap') || sheetName.toLowerCase().includes('future') || sheetName.toLowerCase().includes('plan')) {
      const sheet = workbook.Sheets[sheetName];
      console.log(`\n--- Sheet: ${sheetName} ---`);
      console.log(xlsx.utils.sheet_to_json(sheet, { header: 1 }));
  }
}
