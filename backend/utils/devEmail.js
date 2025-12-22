// Simple development email logger
const devEmail = {
  async send(options) {
    console.log('📧 [DEV] Email would be sent:');
    console.log(`   To: ${options.email}`);
    console.log(`   Subject: ${options.subject}`);
    
    if (options.pin) {
      console.log(`   OTP Code: ${options.pin}`);
      console.log(`   ⚠️  In production, this would be sent via email`);
    }
    
    // Store OTP in memory for testing (optional)
    if (global.devOTPs) {
      global.devOTPs[options.email] = {
        pin: options.pin,
        timestamp: Date.now(),
        expires: Date.now() + 10 * 60 * 1000, // 10 minutes
      };
    }
    
    return { success: true, devMode: true };
  }
};

export default devEmail;