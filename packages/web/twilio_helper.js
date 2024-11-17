// Install the Twilio Node.js helper library
// npm install twilio

const twilio = require('twilio');

// Replace these with your actual Account SID and Auth Token
const accountSid = 'ACad8133aef2d103d474b50e375d494878';
const authToken = 'cb5ffc161f90cc490c39e9f2636b2579';

const client = twilio(accountSid, authToken);

async function createToken() {
  try {
    const token = await client.tokens.create();
    console.log(token.iceServers);
  } catch (error) {
    console.error('Error creating token:', error);
  }
}

createToken();