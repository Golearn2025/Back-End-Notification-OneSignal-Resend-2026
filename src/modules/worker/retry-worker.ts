import { logger } from '../../config/logger.js';

export class RetryWorker {
  // TODO: Retry failed deliveries with backoff strategy.
  async runOnce(): Promise<void> {
    logger.debug('Retry worker stub tick');
  }
}
