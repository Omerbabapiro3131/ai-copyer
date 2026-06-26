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
        if (!entry.isDirectory && !entry.entryName.includes('node_modules') && !entry.entryName.includes('.git') && !entry.entryName.includes('.DS_Store')) {
            try {
                const text = entry.getData().toString('utf8');
                combinedContent += `\n--- DOSYA: ${entry.entryName} ---\n${text}\n`;
            } catch (e) {}
        }
    });
    return combinedContent;
}

app.post('/api/analyze', upload.single('zipfile'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Dosya yuklenmedi.' });

        const zipPath = req.file.path;
        const codeContext = getZipStructureAndContent(zipPath);

        if (!codeContext.trim()) {
            return res.json({ success: true, analysis: "Zip icinde okunabilir kod dosyasi bulunamadi.", zipPath: zipPath });
        }

        const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: "Asagida bir projenin kaynak kodlari verilmistir. Bu projenin ne ise yaradigini, amacini ve ne uygulamasi oldugunu kisaca ozetle.\n\n" + codeContext }] }]
        });

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
        if (!fs.existsSync(zipPath)) return res.status(400).json({ success: false, error: 'Dosya zamanasina ugradi veya silindi.' });

        const zip = new AdmZip(zipPath);
        const zipEntries = zip.getEntries();
        
        for (let entry of zipEntries) {
            if (!entry.isDirectory && !entry.entryName.includes('node_modules') && !entry.entryName.includes('.git') && !entry.entryName.includes('.DS_Store')) {
                const originalCode = entry.getData().toString('utf8');
                
                const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
                const aiPrompt = `Sana bir dosya icerigi ve kullanicinin yapmak istedigi degisiklik talebi verilecek. Sadece kodun guncellenmis halini cikti olarak ver. Markdown aciklamasi, kod blogu veya on soz ekleme. Direkt ham kodu ver.\nDosya Adi: ${entry.entryName}\nKullanici Talebi: ${prompt}\nOrijinal Icerik:\n${originalCode}`;

                const result = await model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: aiPrompt }] }]
                });
                
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
    if (!zipPath || !fs.existsSync(zipPath)) return res.status(404).send('Dosya bulunamadi.');
    
    res.download(zipPath, name || 'output.zip', () => {
        try { fs.unlinkSync(zipPath); } catch (e) {}
    });
});

module.exports = app;
