import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { ReportContext, renderReportHtml } from './html.js';

/** Renders the shared report template to HTML, then prints it to PDF via headless Chrome. */
export async function generatePdf(ctx: ReportContext, outputPath: string = 'dat-report.pdf'): Promise<void> {
    try {
        const htmlContent = renderReportHtml(ctx);

        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'load' });
        // Allow the QuickChart image (loaded from the internet) to fetch.
        await new Promise(r => setTimeout(r, 2000));

        const fullPath = path.resolve(process.cwd(), outputPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });

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
