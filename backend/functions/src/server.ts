import "reflect-metadata"
import express from 'express';
import { container } from 'tsyringe';
import { CrawlerHost } from './cloud-functions/crawler';

const app = express();
const port = process.env.PORT || 8072;

container.registerSingleton(CrawlerHost);

const crawlerHost = container.resolve(CrawlerHost);

app.use(express.json());

// Add error handling middleware
const errorHandler = (err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
};

// Add process error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Continue running but log the error
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Continue running but log the error
});

// Example curl for /crawl:
// curl -X GET "http://localhost:8072/https://example.com"
app.get('/:url(*)', async (req, res, next): Promise<void> => {
  try {
    if (req.params.url === 'favicon.ico') {
      res.status(204).end();
      return;
    }
    await crawlerHost.crawl(req, res);
    return;
  } catch (error) {
    next(error);
    return;
  }
});

// Example curl for /hello:
// curl -X GET "http://localhost:8072/hello"
app.get('/hello', (req, res) => {
  res.json({ message: 'Hello, World!' });
});

// Register error handler last
app.use(errorHandler);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

export default app;