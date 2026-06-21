const https = require('https');

const secretKey = 'sk_test_9F3sVJTETobVUinTJRgGTTy6E9ElduHGQGtQGZKPFL';

const options = {
  hostname: 'api.clerk.com',
  port: 443,
  path: '/v1/users',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${secretKey}`,
    'Accept': 'application/json'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    try {
      const users = JSON.parse(data);
      if (Array.isArray(users)) {
        console.log('CLERK USERS:', JSON.stringify(users.map(u => ({
          id: u.id,
          email: u.email_addresses?.[0]?.email_address,
          verified: u.email_addresses?.[0]?.verification?.status,
          created: new Date(u.created_at).toISOString()
        })), null, 2));
      } else {
        console.log('CLERK RESPONSE:', data);
      }
    } catch (e) {
      console.error('Failed to parse JSON:', e.message);
      console.log('RAW DATA:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('HTTPS REQUEST ERROR:', e);
});

req.end();
