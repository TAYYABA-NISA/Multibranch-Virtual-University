const jwt = require('jsonwebtoken');

// 1. Define payload and secret key
const payload = { userId: 'usr_102030', role: 'admin' };
const secretKey = 'my_super_secret_key';

// 2. Compose (sign) the token (expires in 1 hour)
const token = jwt.sign(payload, secretKey, { expiresIn: '1h' });
console.log('--- GENERATED TOKEN ---');
console.log(token);

// 3. Verify and decode the token
try {
  const decoded = jwt.verify(token, secretKey);
  console.log('\n--- DECODED PAYLOAD ---');
  console.log(decoded);
} catch (error) {
  console.error('Verification failed:', error.message);
}