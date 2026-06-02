import fs from 'fs';
import path from 'path';

export async function pushToDefectDojo(sarifPath: string, url: string, apiKey: string, productName: string): Promise<boolean> {
  const fullPath = path.resolve(process.cwd(), sarifPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`[DefectDojo] SARIF file not found at ${fullPath}`);
    return false;
  }

  try {
    const fileBuffer = fs.readFileSync(fullPath);
    const blob = new Blob([fileBuffer], { type: 'application/json' });
    
    const formData = new FormData();
    formData.append('scan_type', 'SARIF');
    formData.append('file', blob, 'dat-report.sarif');
    formData.append('product_name', productName);
    formData.append('engagement_name', `DAT Scan - ${new Date().toISOString().split('T')[0]}`);
    formData.append('auto_create_context', 'true');
    formData.append('close_old_findings', 'true');

    const response = await fetch(`${url}/api/v2/import-scan/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Accept': 'application/json'
      },
      body: formData as any,
      // Fail fast instead of hanging indefinitely if DefectDojo is unreachable/slow.
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[DefectDojo] Failed to push report: ${response.status} - ${text}`);
      return false;
    }

    return true;
  } catch (e) {
    console.error(`[DefectDojo] Network error: ${(e as Error).message}`);
    return false;
  }
}
