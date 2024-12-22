const twilio = require('twilio');
const dns = require('dns');
const { promisify } = require('util');
const dnsLookup = promisify(dns.lookup);

class TwilioTest {
    constructor() {
        this.accountSid = 'ACad8133aef2d103d474b50e375d494878';
        this.authToken = 'cb5ffc161f90cc490c39e9f2636b2579';
        this.client = twilio(this.accountSid, this.authToken);
    }

    log(message, type = 'info') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
    }

    async validateTwilioCredentials() {
        try {
            const account = await this.client.api.accounts(this.accountSid).fetch();
            console.log(`Twilio Account Status: ${account.status}`);
            console.log(`Twilio Account Type: ${account.type}`);
            console.log(`Twilio Account Name: ${account.friendlyName}`);
            return true;
        } catch (error) {
            console.log(`Twilio Credentials Error: ${error.message}`, 'error');
            return false;
        }
    }

    parseServerUrl(url) {
        // Remove the protocol prefix for proper parsing
        const cleanUrl = url.replace(/^(stun:|turn:)/, '');
        const [hostPort, ...params] = cleanUrl.split('?');
        const [host, port] = hostPort.split(':');
        
        return {
            host,
            port: port || '3478',
            protocol: url.toLowerCase().includes('tcp') ? 'TCP' : 'UDP',
            type: url.toLowerCase().startsWith('stun:') ? 'STUN' : 'TURN',
            params: params.length ? params[0] : null
        };
    }

    async testServerAccessibility(iceServers) {
        console.log('\nTesting server accessibility...');
        
        for (const server of iceServers) {
            const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
            
            for (const url of urls) {
                const serverInfo = this.parseServerUrl(url);
                
                console.log(`\nTesting ${serverInfo.type} server:`);
                console.log(`  Host: ${serverInfo.host}`);
                console.log(`  Port: ${serverInfo.port}`);
                console.log(`  Protocol: ${serverInfo.protocol}`);
                
                try {
                    const address = await dnsLookup(serverInfo.host);
                    console.log(`  DNS Resolution: Success - ${address.address}`);
                    
                    // Test TCP connectivity
                    await this.testTcpConnection(serverInfo);
                    
                    // Test UDP connectivity
                    await this.testUdpConnection(serverInfo);
                    
                } catch (err) {
                    console.log(`  DNS Resolution: Failed - ${err.message}`);
                }
            }
        }
    }

    async testTcpConnection(serverInfo) {
        const net = require('net');
        const socket = new net.Socket();
        
        try {
            await new Promise((resolve, reject) => {
                socket.setTimeout(5000);
                
                socket.on('connect', () => {
                    socket.end();
                    resolve();
                });
                
                socket.on('timeout', () => {
                    socket.destroy();
                    reject(new Error('Connection timeout'));
                });
                
                socket.on('error', reject);
                
                socket.connect(serverInfo.port, serverInfo.host);
            });
            console.log(`  TCP Port ${serverInfo.port} is accessible`);
        } catch (err) {
            console.log(`  TCP Port ${serverInfo.port} is not accessible: ${err.message}`);
        }
    }

    async testUdpConnection(serverInfo) {
        const dgram = require('dgram');
        const client = dgram.createSocket('udp4');
        
        try {
            await new Promise((resolve, reject) => {
                const testData = Buffer.from('test');
                let responded = false;
                
                client.on('error', (err) => {
                    client.close();
                    reject(err);
                });
                
                client.on('message', () => {
                    responded = true;
                    client.close();
                    resolve();
                });
                
                client.send(testData, serverInfo.port, serverInfo.host, (err) => {
                    if (err) {
                        client.close();
                        reject(err);
                    }
                });
                
                // Set timeout for UDP response
                setTimeout(() => {
                    client.close();
                    if (!responded) {
                        console.log(`  UDP Port ${serverInfo.port} status unknown (no response)`);
                        resolve();
                    }
                }, 5000);
            });
            
        } catch (err) {
            console.log(`  UDP Port ${serverInfo.port} error: ${err.message}`);
        }
    }

    async getIceServers() {
        try {
            const token = await this.client.tokens.create();
            console.log('Successfully retrieved ICE Servers:');
            
            token.iceServers.forEach((server, index) => {
                console.log(`\nServer ${index + 1}:`);
                if (Array.isArray(server.urls)) {
                    server.urls.forEach(url => console.log(`  URL: ${url}`));
                } else {
                    console.log(`  URL: ${server.urls}`);
                }
                
                if (server.username) {
                    console.log(`  Username: ${server.username}`);
                }
                
                if (server.credential) {
                    console.log(`  Credential: [HIDDEN]`);
                }
            });

            await this.testServerAccessibility(token.iceServers);
            
            return token.iceServers;
        } catch (error) {
            console.log(`Failed to get ICE servers: ${error.message}`, 'error');
            throw error;
        }
    }

    // Add this new method to test ICE candidates
    async testIceCandidates() {
        const webrtc = require('@koush/wrtc');
        const pc = new webrtc.RTCPeerConnection({
            iceServers: await this.getIceServers()
        });
        
        console.log('\nGathering ICE candidates...');
        
        return new Promise((resolve) => {
            const candidates = [];
            let gatheringComplete = false;
            
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    const candidate = event.candidate;
                    candidates.push(candidate);
                    console.log('\nNew ICE candidate:');
                    console.log(`  Type: ${candidate.type}`);
                    console.log(`  Protocol: ${candidate.protocol}`);
                    console.log(`  Address: ${candidate.address}`);
                    console.log(`  Port: ${candidate.port}`);
                    console.log(`  Foundation: ${candidate.foundation}`);
                    console.log(`  Priority: ${candidate.priority}`);
                }
            };
            
            pc.onicegatheringstatechange = () => {
                if (pc.iceGatheringState === 'complete' && !gatheringComplete) {
                    gatheringComplete = true;
                    console.log(`\nICE gathering complete. Found ${candidates.length} candidates.`);
                    pc.close();
                    resolve(candidates);
                }
            };
            
            // Create data channel to trigger ICE gathering
            pc.createDataChannel('test');
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .catch(err => console.error('Error creating offer:', err));
        });
    }
}

// Update the runTest function to include ICE candidate testing
async function runTest() {
    const test = new TwilioTest();
    try {
        console.log('Starting Twilio ICE Server Test...\n');
        
        // Validate credentials
        console.log('Validating Twilio credentials...');
        const credentialsValid = await test.validateTwilioCredentials();
        if (!credentialsValid) {
            throw new Error('Invalid Twilio credentials');
        }

        // Get and test ICE servers
        console.log('\nRetrieving ICE servers...');
        const iceServers = await test.getIceServers();
        
        // Test ICE candidates
        await test.testIceCandidates();
        
        console.log('\nTest completed successfully');

    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    runTest();
}

module.exports = TwilioTest;