import ExcelJS from 'exceljs';

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile('DAT_Development_Plan.xlsx');
console.log('Sheets:', workbook.worksheets.map(ws => ws.name));

for (const sheet of workbook.worksheets) {
  const name = sheet.name;
  if (name.toLowerCase().includes('roadmap') || name.toLowerCase().includes('future') || name.toLowerCase().includes('plan')) {
    console.log(`\n--- Sheet: ${name} ---`);
    const rows = [];
    // row.values is 1-indexed (index 0 is empty); slice(1) gives a plain array of cell values.
    sheet.eachRow({ includeEmpty: true }, (row) => rows.push((row.values || []).slice(1)));
    console.log(rows);
  }
}
