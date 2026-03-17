const pdfParse = require('pdf-parse');
const fs = require('fs');

async function testV1() {
    try {
        console.log("Testing pdf-parse v1.1.1...");
        // Minimal PDF data for testing initialization
        const data = Buffer.from("JVBERi0xLjEKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqIDIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iaiAzIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9SZXNvdXJjZXM8PC9Gb250PDwvRjE8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+Pj4+Pi9Db250ZW50cyA0IDAgUj4+ZW5kb2JqIDQgMCBvYmo8PC9MZW5ndGggMjQ+PnN0cmVhbUJUL0YxIDEyIFRmIDAgMCBUZChUZXN0KUV0ZW5kc3RyZWFtZW5kb2JqIHRyYWlsZXI8PC9TaXplIDUvUm9vdCAxIDAgUj4+c3RhcnR4cmVmIDE0OQolJUVPRg==");
        const result = await pdfParse(data);
        console.log("Successfully parsed PDF text snippet:", result.text.substring(0, 20));
        process.exit(0);
    } catch (err) {
        console.error("Verification failed:", err);
        process.exit(1);
    }
}

testV1();
