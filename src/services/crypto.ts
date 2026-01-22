export class CryptoService {
    static async getMasterKey(masterKeyStr: string): Promise<CryptoKey> {
        const rawKey = new TextEncoder().encode(masterKeyStr);
        // We need exactly 16, 24, or 32 bytes for AES.
        // If the provided key is not the right length, we'll hash it.
        const hash = await crypto.subtle.digest("SHA-256", rawKey);
        return crypto.subtle.importKey(
            "raw",
            hash,
            { name: "AES-GCM" },
            false,
            ["encrypt", "decrypt"]
        );
    }

    static async encrypt(plaintext: string, key: CryptoKey): Promise<{ ciphertext: string, iv: string }> {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(plaintext);
        const ciphertextBuffer = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            key,
            encoded
        );

        return {
            ciphertext: this.arrayBufferToBase64(ciphertextBuffer),
            iv: this.arrayBufferToBase64(iv.buffer)
        };
    }

    static async decrypt(ciphertextB64: string, ivB64: string, key: CryptoKey): Promise<string> {
        const ciphertext = this.base64ToArrayBuffer(ciphertextB64);
        const iv = this.base64ToArrayBuffer(ivB64);

        try {
            const decryptedBuffer = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv },
                key,
                ciphertext
            );
            return new TextDecoder().decode(decryptedBuffer);
        } catch (error) {
            console.error("Decryption failed:", error);
            throw new Error("Failed to decrypt API key. Ensure AIRTABLE_MASTER_KEY is correct.");
        }
    }

    private static arrayBufferToBase64(buffer: ArrayBuffer): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    private static base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
}
