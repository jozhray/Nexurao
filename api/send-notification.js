// Vercel Serverless Function for FCM Push Notifications
// Uses FCM HTTP v1 API with Service Account authentication

export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { token, title, body, data } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Missing FCM token' });
        }

        // Get Service Account from environment variable
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

        // Generate OAuth2 access token
        const accessToken = await getAccessToken(serviceAccount);

        // Build FCM v1 message payload
        const message = {
            message: {
                token: token,
                notification: {
                    title: title || 'New Message',
                    body: body || 'You have a new message'
                },
                data: data || {},
                android: {
                    priority: 'high',
                    notification: {
                        sound: 'default',
                        channel_id: 'messages'
                    }
                }
            }
        };

        // Send to FCM HTTP v1 API
        const fcmResponse = await fetch(
            `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(message)
            }
        );

        const result = await fcmResponse.json();

        if (!fcmResponse.ok) {
            console.error('FCM Error:', result);
            return res.status(fcmResponse.status).json({ error: result });
        }

        return res.status(200).json({ success: true, messageId: result.name });

    } catch (error) {
        console.error('Server error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// Generate OAuth2 access token from Service Account
async function getAccessToken(serviceAccount) {
    const jwt = await createJWT(serviceAccount);

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt
        })
    });

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
}

// Create JWT for Service Account authentication
async function createJWT(serviceAccount) {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);

    const payload = {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
    };

    const encodedHeader = base64urlEncode(JSON.stringify(header));
    const encodedPayload = base64urlEncode(JSON.stringify(payload));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    // Sign with private key
    const signature = await signWithPrivateKey(signatureInput, serviceAccount.private_key);

    return `${signatureInput}.${signature}`;
}

function base64urlEncode(str) {
    return Buffer.from(str)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

async function signWithPrivateKey(data, privateKey) {
    const crypto = await import('crypto');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(data);
    const signature = sign.sign(privateKey, 'base64');
    return signature.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
