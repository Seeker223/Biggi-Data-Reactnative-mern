import Queue from 'bull';
import emailService from './emailService.js';

// Create email queue
const emailQueue = new Queue('email', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || '',
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

// Process email jobs
emailQueue.process(async (job) => {
  const { type, data } = job.data;
  
  switch(type) {
    case 'verification':
      return await emailService.sendWithFallback({
        email: data.email,
        subject: data.subject,
        message: data.message,
        pin: data.pin,
        username: data.username,
      });
    
    case 'welcome':
      // ... other email types
      break;
    
    default:
      throw new Error(`Unknown email type: ${type}`);
  }
});

// Add email to queue
export const addToEmailQueue = (type, data, options = {}) => {
  return emailQueue.add({ type, data }, options);
};

// Export the queue for direct access if needed
export default emailQueue;