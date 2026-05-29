import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import ejs from 'ejs';
import { AggregatedReport } from '../types.js';
import { calculateReadinessScore } from '../utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function generatePdf(report: AggregatedReport, outputPath: string = 'dat-report.pdf'): Promise<void> {
    try {
        const templatePath = path.resolve(__dirname, 'templates/report.ejs');
        const templateStr = fs.readFileSync(templatePath, 'utf8');
        
        // Render HTML string via EJS, passing both report and the centralized score calculator
        const htmlContent = ejs.render(templateStr, { report, calculateReadinessScore });

        // Launch headless browser
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Wait for network idle to ensure QuickChart image loads
        await page.setContent(htmlContent, { waitUntil: 'load' });
        
        // Ensure chart images from the internet are fetched
        await new Promise(r => setTimeout(r, 2000));
        
        const fullPath = path.resolve(process.cwd(), outputPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });

        // Generate PDF
        await page.pdf({
            path: fullPath,
            format: 'A4',
            printBackground: true,
            margin: { top: '40px', bottom: '40px', left: '40px', right: '40px' }
        });
        
        await browser.close();
    } catch (err) {
        console.error(`[PDF Generator] Failed to generate PDF: ${(err as Error).message}`);
    }
}
