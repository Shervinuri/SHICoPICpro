// This is your serverless function that acts as a smart gateway.
// It receives requests from your frontend and forwards them to the target API
// using server-side proxies to avoid rate limiting.

// Use node-fetch for making requests in a Node.js environment (Netlify Functions)
const fetch = require('node-fetch');

// List of reliable, server-grade proxies.
const PROXIES = [
    'https://proxy.cors.sh/',
    // You can add other reliable server-side proxies here in the future.
];

let proxyIndex = 0; // Index to rotate through the proxies

exports.handler = async (event, context) => {
    // 1. Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 2. Get the user's prompt from the request body sent by your frontend
        const { chatHistory } = JSON.parse(event.body);

        if (!chatHistory) {
            return { statusCode: 400, body: 'Missing chatHistory in request body' };
        }

        const targetApiUrl = 'https://text.pollinations.ai/openai';

        // 3. THE TRICK: Rotate the proxy for each function invocation
        const proxyUrl = PROXIES[proxyIndex];
        proxyIndex = (proxyIndex + 1) % PROXIES.length; // Move to the next proxy for the next request

        const proxiedUrl = `${proxyUrl}${targetApiUrl}`;

        console.log(`Forwarding request via server-side proxy: ${proxyUrl}`);

        // 4. Make the fetch request from the server-side function through the proxy
        const response = await fetch(proxiedUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // This specific header is often required by cors.sh proxy
                'x-cors-api-key': 'temp_1234567890',
            },
            body: JSON.stringify({
                model: 'openai',
                messages: chatHistory
            })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Proxy fetch failed with status: ${response.status} - ${errorBody}`);
        }

        const data = await response.json();

        // 5. Return the successful response to the frontend
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*', // Allow your frontend to call this function
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        };

    } catch (error) {
        console.error('Error in Netlify function:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to enhance prompt.' }),
        };
    }
};

