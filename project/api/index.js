const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { GoogleGenAI } = require('@google/generative-ai');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: '/tmp/' });

const ai = new GoogleGenAI({ apiKey: "AQ.Ab8RN6IbykKIWJogfJTFKxEVY_8YSSuoGdotSeWy0roOCDdwxA" });

function getZipStructureAndContent(zipPath) {
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();
    let combinedContent = "";

    zipEntries.forEach((entry) => {
        if (!entry.isDirectory && !entry.entryName.includes('node_modules') && !entry.entryName.includes('.git')) {
            const text = entry.getData().toString('utf8');
            combinedContent += `\n--- DOSYA: ${entry.entryName} ---\n${text}\n`;
        }
    });
    return combinedContent;
}

app.post('/api/analyze', upload.single('zipfile'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Dosya yüklenmedi.' });

        const zipPath = req.file.path;
        const codeContext = getZipStructureAndContent(zipPath);

        const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent([
            "Aşağıda bir projenin kaynak kodları verilmiştir. Bu projenin ne işe yaradığını, amacını ve ne uygulamasını olduğunu kısaca özetle.",
            codeContext
        ]);

        res.json({
            success: true,
            analysis: result.response.text(),
            zipPath: zipPath
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/modify', async (req, res) => {
    try {
        const { zipPath, prompt } = req.body;
        if (!zipPath || !prompt) return res.status(400).json({ success: false, error: 'Eksik parametre.' });

        const zip = new AdmZip(zipPath);
        const zipEntries = zip.getEntries();
        
        for (let entry of zipEntries) {
            if (!entry.isDirectory && !entry.entryName.includes('node_modules') && !entry.entryName.includes('.git')) {
                const originalCode = entry.getData().toString('utf8');
                
                const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
                const aiPrompt = `Sana bir dosya içeriği ve kullanıcının yapmak istediği değişiklik talebi verilecek. Sadece kodun güncellenmiş halini çıktı olarak ver. Markdown açıklaması, kod bloğu (\`\`\`) veya ön söz/son söz ekleme. Direkt ham kodu ver.
Dosya Adı: ${entry.entryName}
Kullanıcı Talebi: ${prompt}
Orijinal İçerik:
${originalCode}`;

                const result = await model.generateContent([aiPrompt]);
                let updatedCode = result.response.text();
                
                zip.updateFile(entry.entryName, Buffer.from(updatedCode, 'utf8'));
            }
        }

        zip.writeZip(zipPath);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/download', (req, res) => {
    const { path: zipPath, name } = req.query;
    if (!zipPath || !fs.existsSync(zipPath)) return res.status(404).send('Dosya bulunamadı.');
    
    res.download(zipPath, name || 'output.zip', () => {
        try { fs.unlinkSync(zipPath); } catch (e) {}
    });
});

module.exports = app;
