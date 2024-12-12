import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs';
import crypto from 'crypto';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

class FirestoreAnonymousClient {
    constructor(firebaseConfig, referer) {
        this.firebaseConfig = firebaseConfig;
        this.referer = referer;
        this.proxyAgent = new HttpsProxyAgent('http://127.0.0.1:8080');
    }

    logStatus(message) {
        console.log(`[${new Date().toISOString()}] ${message}`);
    }

    async signInAnonymously() {
        const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${this.firebaseConfig.apiKey}`;
        
        this.logStatus(`Signing in anonymously with referer ${this.referer}`);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Referer': this.referer
            },
            body: JSON.stringify({}),
            agent: this.proxyAgent
        });

        if (!response.ok) throw new Error(`Error signing in anonymously: ${response.statusText}`);

        const data = await response.json();
        this.logStatus('Successfully signed in anonymously.');
        return data.idToken;
    }

    async signInWithPassword(email, password) {
        const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${this.firebaseConfig.apiKey}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Referer': this.referer
            },
            body: JSON.stringify({
                email,
                password,
                returnSecureToken: true
            }),
            agent: this.proxyAgent
        });

        if (!response.ok) throw new Error(`Error signing in with password: ${response.statusText}`);

        const data = await response.json();
        return data.idToken; // Return the idToken for further requests
    }
}

const fetchDocuments = async (idToken, firebaseConfig, collection, limit, recent) => {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents:runQuery?key=${firebaseConfig.apiKey}`;

    const queryBody = {
        structuredQuery: {
            from: [{ collectionId: collection, allDescendants: false }],
            limit,
            ...(recent ? { orderBy: [{ field: { fieldPath: "created_at" }, direction: "DESCENDING" }] } : {})
        }
    };

    console.log(`[${new Date().toISOString()}] Fetching documents from the "${collection}" collection.`);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(queryBody),
            agent: new HttpsProxyAgent('http://127.0.0.1:8080')
        });

        if (!response.ok) {
            const errorData = await response.json();
            if (errorData[0].error.code === 401) {
                console.error('\x1b[31mUnauthorized status to the collection.\x1b[0m'); // Red text
                throw new Error("UNAUTHENTICATED");
            } else if (errorData[0].error.code === 403) {
                console.error('\x1b[31mPermission denied for accessing the collection.\x1b[0m'); // Red text
                throw new Error("PERMISSION_DENIED");
            }
            throw new Error(`Error fetching documents: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Handle output based on --output flag
        if (args.includes('--output')) {
            console.log('\x1b[32mFetched documents:\x1b[0m', JSON.stringify(data, null, 2)); // Green text
        } else {
            // Generate a random filename
            const randomFilename = crypto.randomBytes(8).toString('hex') + '.json';
            
            // Write fetched data to a file
            fs.writeFileSync(randomFilename, JSON.stringify(data, null, 2));
            
            console.log(`[${new Date().toISOString()}] Documents fetched successfully.`);
            console.log('\x1b[32mFetched documents saved to:\x1b[0m', randomFilename); // Green text
        }

        // Count and display number of returned objects if it's an array
        if (Array.isArray(data)) {
            console.log(`\x1b[32mNumber of documents returned:\x1b[0m ${data.length}`); // Green text
        }
        
        return data; // Return fetched data for comparison
        
    } catch (error) {
        if (args.includes('--debug')) { // Print detailed error only if --debug is set
            console.error("Error fetching documents:", error);
        }
        throw error; // Rethrow error for further handling
    }
};

const showHelpBanner = () => {
    console.log(`
Usage:
  node firebase-anonymous.js --referer=<referer> --collection=<collection> [options]

Options:
  -h, --help          Show this help message
  --recent            Fetch recent documents ordered by created_at
  --limit=<number>    Limit the number of documents returned (default is 10)
  --monitor           Continuously fetch documents every 5 seconds and exit on change
  --user=<email>      User email for authentication
  --password=<pass>   User password for authentication
  --output            Print JSON output to terminal instead of saving it to a file
  --debug             Print detailed error messages to the terminal
`);
};

const firebaseConfig = {
    apiKey: "AIzxxxxxxykc",
    authDomain: "xxxxx.firebaseapp.com",
    databaseURL: "https://xxxxx.firebaseio.com",
    projectId: "xxxx",
    storageBucket: "XXX",
    messagingSenderId: "xxx",
    appId: "yyy"
};

const args = process.argv.slice(2);
const referer = args.find(arg => arg.startsWith('--referer='))?.split('=')[1] || '';
const collectionArg = args.find(arg => arg.startsWith('--collection='));
const recentFlag = args.includes('--recent');
const limitArg = args.find(arg => arg.startsWith('--limit='));
const monitorFlag = args.includes('--monitor');
const userArg = args.find(arg => arg.startsWith('--user='));
const passwordArg = args.find(arg => arg.startsWith('--password='));

if (args.includes('-h') || args.includes('--help')) {
    showHelpBanner();
    process.exit(0);
}

if (!collectionArg) {
    console.error("Error: The --collection argument is required.");
    process.exit(1);
}

const collection = collectionArg.split('=')[1];
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 10;

const main = async () => {
    const client = new FirestoreAnonymousClient(firebaseConfig, referer);
    
    try {
        let idToken;

        // First attempt to sign in anonymously
        try {
            idToken = await client.signInAnonymously();
            
            // Attempt to fetch documents
            await fetchDocuments(idToken, firebaseConfig, collection, limit, recentFlag);
            
        } catch (error) {
            // Check for user credentials if unauthorized or permission denied
            if (error.message === "UNAUTHENTICATED" || error.message === "PERMISSION_DENIED") {
                if (userArg && passwordArg) {
                    const email = userArg.split('=')[1];
                    const password = passwordArg.split('=')[1];
                    try {
                        idToken = await client.signInWithPassword(email, password);
                        // Attempt to fetch documents again with authenticated token
                        await fetchDocuments(idToken, firebaseConfig, collection, limit, recentFlag);
                    } catch (authError) {
                        if (args.includes('--debug')) { // Print detailed error only if --debug is set
                            console.error("Error during authentication:", authError);
                        }
                    }
                } else {
                    console.error("Error: User credentials are required for authenticated access.");
                    process.exit(1);
                }
                
            } else {
                if (args.includes('--debug')) { // Print detailed error only if --debug is set
                    console.error("Error:", error);
                }
                process.exit(1);
            }
        }
        
    } catch (error) {
        if (args.includes('--debug')) { // Print detailed error only if --debug is set
            console.error("Error:", error);
        }
    }
};

main();
