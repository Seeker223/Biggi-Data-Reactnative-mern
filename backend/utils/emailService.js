import sendEmail from "./sendEmail.js";

class EmailService {
  constructor() {
    this.primaryService = 'smtp';
    this.services = ['smtp', 'resend', 'sendgrid'];
    this.currentServiceIndex = 0;
  }

  async sendWithFallback(options) {
    const maxRetries = this.services.length;
    
    for (let i = 0; i < maxRetries; i++) {
      const service = this.services[this.currentServiceIndex];
      
      try {
        console.log(`🔄 Trying email service: ${service}`);
        
        switch(service) {
          case 'smtp':
            return await sendEmail(options);
          
          case 'resend':
            return await this.sendWithResend(options);
          
          case 'sendgrid':
            return await this.sendWithSendGrid(options);
          
          default:
            throw new Error(`Unknown service: ${service}`);
        }
      } catch (error) {
        console.error(`❌ ${service} failed:`, error.message);
        
        // Move to next service
        this.currentServiceIndex = (this.currentServiceIndex + 1) % this.services.length;
        
        // If last service failed, throw error
        if (i === maxRetries - 1) {
          throw new Error(`All email services failed: ${error.message}`);
        }
      }
    }
  }

  async sendWithResend(options) {
    // Implementation for Resend.com
    const { Resend } = await import('resend');
    
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY not configured');
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    
    const { data, error } = await resend.emails.send({
      from: 'Biggi Data <onboarding@resend.dev>',
      to: options.email,
      subject: options.subject,
      html: options.html || options.message,
    });

    if (error) throw error;
    
    return { success: true, messageId: data.id };
  }

  async sendWithSendGrid(options) {
    // Implementation for SendGrid
    const sgMail = await import('@sendgrid/mail');
    
    if (!process.env.SENDGRID_API_KEY) {
      throw new Error('SENDGRID_API_KEY not configured');
    }

    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    
    const msg = {
      to: options.email,
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@biggidata.com',
      subject: options.subject,
      text: options.message.replace(/<[^>]*>/g, ''),
      html: options.html || options.message,
    };

    await sgMail.send(msg);
    return { success: true };
  }
}

export default new EmailService();