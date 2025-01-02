const express = require('express');
const puppeteer = require('puppeteer');
const app = express();
const port = process.env.PORT || 8071;

app.get('/:url(*)', async (req, res) => {
    const startTime = Date.now();
    const url = `https://${req.params.url}`;
    const timing = {};

    console.log(`\n🌐 Processing request for: ${url}`);

    try {
        console.log('📱 Launching browser...');
        timing.browserLaunchStart = Date.now();
        const browser = await puppeteer.launch({
            headless: 'true',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        timing.browserLaunchEnd = Date.now();
        timing.browserLaunchDuration = timing.browserLaunchEnd - timing.browserLaunchStart;
        console.log(`Browser launched in ${timing.browserLaunchDuration}ms`);

        timing.pageCreateStart = Date.now();
        const page = await browser.newPage();
        timing.pageCreateEnd = Date.now();
        timing.pageCreateDuration = timing.pageCreateEnd - timing.pageCreateStart;
        console.log(`Page created in ${timing.pageCreateDuration}ms`);

        console.log('🏃 Navigating to page...');
        timing.navigationStart = Date.now();
        await page.goto(url, { waitUntil: 'networkidle0' });
        timing.navigationEnd = Date.now();
        timing.navigationDuration = timing.navigationEnd - timing.navigationStart;
        console.log(`Navigation completed in ${timing.navigationDuration}ms`);

        timing.contentExtractionStart = Date.now();
        const content = await page.content();
        timing.contentExtractionEnd = Date.now();
        timing.contentExtractionDuration = timing.contentExtractionEnd - timing.contentExtractionStart;
        console.log(`Content extracted in ${timing.contentExtractionDuration}ms`);

        timing.browserCloseStart = Date.now();
        await browser.close();
        timing.browserCloseEnd = Date.now();
        timing.browserCloseDuration = timing.browserCloseEnd - timing.browserCloseStart;
        console.log('🔒 Browser closed');

        const endTime = Date.now();
        const totalExecutionTime = endTime - startTime;

        console.log(`✅ Request completed in ${totalExecutionTime}ms`);
        console.log('\n⏱️ Timing Breakdown:');
        console.table({
            'Browser Launch': timing.browserLaunchDuration,
            'Page Creation': timing.pageCreateDuration,
            'Navigation': timing.navigationDuration,
            'Content Extraction': timing.contentExtractionDuration,
            'Browser Close': timing.browserCloseDuration,
            'Total Time': totalExecutionTime
        });

        res.send({
            content,
            executionTime: totalExecutionTime,
            timing,
            status: 'success'
        });
    } catch (error) {
        console.error(`❌ Error processing ${url}:`, error.message);
        res.status(500).send({
            error: error.message,
            timing,
            status: 'error'
        });
    }
});

app.listen(port, () => {
    console.log(`
🚀 Server is running!
🌍 URL: http://localhost:${port}
📝 Usage: http://localhost:${port}/example.com
    `);
});