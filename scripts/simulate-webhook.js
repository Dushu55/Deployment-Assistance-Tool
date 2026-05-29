import crypto from 'crypto';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'development';
const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}/api/github/webhooks`;

const mockPayload = {
  action: 'opened',
  pull_request: {
    number: 42,
    head: {
      ref: 'feature/test-branch',
      sha: '1234567890abcdef1234567890abcdef12345678'
    }
  },
  repository: {
    name: 'test-repo',
    full_name: 'test-org/test-repo',
    owner: {
      login: 'test-org'
    }
  },
  installation: {
    id: 999999
  }
};

const payloadString = JSON.stringify(mockPayload);
const signature = `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(payloadString).digest('hex')}`;

console.log(`Sending mock pull_request webhook to ${URL}...`);

try {
  const response = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'pull_request',
      'X-Hub-Signature-256': signature,
      'X-GitHub-Delivery': 'mock-delivery-id-123'
    },
    body: payloadString
  });

  const text = await response.text();
  console.log(`Response Status: ${response.status}`);
  console.log(`Response Body: ${text}`);
} catch (error) {
  console.error('Failed to send webhook. Is the Probot server running (npm run dev:app)?', error.message);
}
