const axios = require('axios');
const chalk = require('chalk'); // Add for colored output

async function testUrl(type, url, iteration) {
    console.log(chalk.blue(`\n[${type}] Test #${iteration + 1} starting...`));
    const start = Date.now();

    try {
        const port = type === 'Docker' ? 8072 : 8071;
        const response = await axios.get(`http://localhost:${port}/${url}`);
        const { executionTime, timing } = response.data;

        console.log(chalk.green(`✓ [${type}] Test #${iteration + 1} completed in ${executionTime}ms`));
        console.log(chalk.gray('Timing breakdown:'));
        console.table({
            'Browser Launch': timing.browserLaunchDuration,
            'Page Creation': timing.pageCreateDuration,
            'Navigation': timing.navigationDuration,
            'Content Extraction': timing.contentExtractionDuration,
            'Browser Close': timing.browserCloseDuration
        });

        return {
            total: executionTime,
            ...timing
        };
    } catch (error) {
        console.log(chalk.red(`✗ [${type}] Test #${iteration + 1} failed: ${error.message}`));
        return null;
    }
}

async function runTest(urls) {
    const results = {
        dockerized: [],
        local: []
    };

    console.log(chalk.yellow('\n🚀 Starting performance tests'));
    console.log(chalk.yellow('=' . repeat(50)));

    for (const url of urls) {
        console.log(chalk.cyan(`\n📍 Testing: ${url}`));
        
        for (let i = 0; i < 2; i++) {
            const dockerTime = await testUrl('Docker', url, i);
            if (dockerTime) results.dockerized.push({ url, ...dockerTime });

            const localTime = await testUrl('Local', url, i);
            if (localTime) results.local.push({ url, ...localTime });

            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    return results;
}

function calculateAverages(timings) {
    return {
        total: timings.reduce((sum, t) => sum + t.total, 0) / timings.length,
        browserLaunch: timings.reduce((sum, t) => sum + t.browserLaunchDuration, 0) / timings.length,
        pageCreate: timings.reduce((sum, t) => sum + t.pageCreateDuration, 0) / timings.length,
        navigation: timings.reduce((sum, t) => sum + t.navigationDuration, 0) / timings.length,
        contentExtraction: timings.reduce((sum, t) => sum + t.contentExtractionDuration, 0) / timings.length,
        browserClose: timings.reduce((sum, t) => sum + t.browserCloseDuration, 0) / timings.length
    };
}

function displayResults(results) {
    console.log(chalk.yellow('\n📊 Test Results Summary'));
    console.log(chalk.yellow('=' . repeat(50)));

    const urlResults = {};
    
    results.dockerized.forEach(result => {
        if (!urlResults[result.url]) urlResults[result.url] = { docker: [], local: [] };
        urlResults[result.url].docker.push(result);
    });
    
    results.local.forEach(result => {
        if (!urlResults[result.url]) urlResults[result.url] = { docker: [], local: [] };
        urlResults[result.url].local.push(result);
    });

    Object.entries(urlResults).forEach(([url, data]) => {
        console.log(chalk.cyan(`\n🌐 Results for: ${url}`));
        
        const dockerAvg = calculateAverages(data.docker);
        const localAvg = calculateAverages(data.local);

        console.table({
            'Browser Launch': {
                'Docker': `${dockerAvg.browserLaunch.toFixed(2)}ms`,
                'Local': `${localAvg.browserLaunch.toFixed(2)}ms`,
                'Difference': `${((dockerAvg.browserLaunch - localAvg.browserLaunch) / localAvg.browserLaunch * 100).toFixed(2)}%`
            },
            'Page Creation': {
                'Docker': `${dockerAvg.pageCreate.toFixed(2)}ms`,
                'Local': `${localAvg.pageCreate.toFixed(2)}ms`,
                'Difference': `${((dockerAvg.pageCreate - localAvg.pageCreate) / localAvg.pageCreate * 100).toFixed(2)}%`
            },
            'Navigation': {
                'Docker': `${dockerAvg.navigation.toFixed(2)}ms`,
                'Local': `${localAvg.navigation.toFixed(2)}ms`,
                'Difference': `${((dockerAvg.navigation - localAvg.navigation) / localAvg.navigation * 100).toFixed(2)}%`
            },
            'Content Extraction': {
                'Docker': `${dockerAvg.contentExtraction.toFixed(2)}ms`,
                'Local': `${localAvg.contentExtraction.toFixed(2)}ms`,
                'Difference': `${((dockerAvg.contentExtraction - localAvg.contentExtraction) / localAvg.contentExtraction * 100).toFixed(2)}%`
            },
            'Browser Close': {
                'Docker': `${dockerAvg.browserClose.toFixed(2)}ms`,
                'Local': `${localAvg.browserClose.toFixed(2)}ms`,
                'Difference': `${((dockerAvg.browserClose - localAvg.browserClose) / localAvg.browserClose * 100).toFixed(2)}%`
            },
            'Total': {
                'Docker': `${dockerAvg.total.toFixed(2)}ms`,
                'Local': `${localAvg.total.toFixed(2)}ms`,
                'Difference': `${((dockerAvg.total - localAvg.total) / localAvg.total * 100).toFixed(2)}%`
            }
        });
    });

    // Overall averages
    const allDockerResults = Object.values(urlResults).flatMap(r => r.docker);
    const allLocalResults = Object.values(urlResults).flatMap(r => r.local);
    
    const overallDockerAvg = calculateAverages(allDockerResults);
    const overallLocalAvg = calculateAverages(allLocalResults);

    console.log(chalk.yellow('\n📈 Overall Performance Across All URLs'));
    console.log(chalk.yellow('=' . repeat(50)));
    console.table({
        'Browser Launch': {
            'Docker': `${overallDockerAvg.browserLaunch.toFixed(2)}ms`,
            'Local': `${overallLocalAvg.browserLaunch.toFixed(2)}ms`,
            'Difference': `${((overallDockerAvg.browserLaunch - overallLocalAvg.browserLaunch) / overallLocalAvg.browserLaunch * 100).toFixed(2)}%`
        },
        'Total': {
            'Docker': `${overallDockerAvg.total.toFixed(2)}ms`,
            'Local': `${overallLocalAvg.total.toFixed(2)}ms`,
            'Difference': `${((overallDockerAvg.total - overallLocalAvg.total) / overallLocalAvg.total * 100).toFixed(2)}%`
        }
    });
}

// Run the test
(async () => {
    const urls = [
        'en.wikipedia.org/wiki/JavaScript',
        'en.wikipedia.org/wiki/Docker_(software)',
        'en.wikipedia.org/wiki/Node.js',
        'github.com',
        'stackoverflow.com',
        'example.com'
    ];
    
    const results = await runTest(urls);
    displayResults(results);
})();