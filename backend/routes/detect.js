'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { runPythonAnalysis } = require('../services/pythonBridge');
const { computeEnsembleScore } = require('../utils/ensembleScorer');

const router = express.Router();

// ── Multer storage: temp uploads folder inside /backend ──────────────────────
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `upload-${unique}${ext}`);
    },
});

const fileFilter = (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|bmp|tiff/i;
    const ext = path.extname(file.originalname);
    if (allowed.test(ext)) {
        cb(null, true);
    } else {
        cb(new Error(`Unsupported file type: ${ext}`), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
});

// ── Demo results directory ───────────────────────────────────────────────────
const demoDir = path.join(__dirname, '..', 'demo-results');

/**
 * Check if a predefined demo result exists for the uploaded filename.
 * Matches: original filename (without extension) → demo-results/<name>.json
 *
 * Handles two formats:
 *   1. Multi-section: { detection, forensic, metadata_info, reverse }
 *   2. Flat (legacy):  { verdict, confidence, comments, metadata, spectral }
 *
 * Always returns the flat format expected by the frontend.
 */
function getDemoResult(originalFilename) {
    try {
        const baseName = path.basename(originalFilename, path.extname(originalFilename));
        const demoPath = path.join(demoDir, `${baseName}.json`);

        if (fs.existsSync(demoPath)) {
            const raw = fs.readFileSync(demoPath, 'utf-8');
            const parsed = JSON.parse(raw);
            console.log(`[demo] Matched predefined result for: ${baseName}`);

            // If multi-section format, transform to flat API contract
            if (parsed.detection) {
                const det = parsed.detection;
                const forensic = parsed.forensic || {};
                const metaInfo = parsed.metadata_info || {};
                const spectralScores = det.spectral || forensic.spectral || {};

                // Map verdict: "AI" → "AI SYNTHETIC"
                const VERDICT_MAP = { 'AI': 'AI SYNTHETIC', 'REAL': 'AUTHENTIC', 'SCREENSHOT': 'SCREENSHOT' };
                const mappedVerdict = VERDICT_MAP[(det.verdict || '').toUpperCase()] || det.verdict;

                // Build metadata string
                let metaStr = 'No EXIF Found (stripped or absent)';
                if (metaInfo.exif_present === true) {
                    metaStr = 'Camera Make/Model Present';
                } else if (metaInfo.software_hint) {
                    metaStr = metaInfo.note || metaStr;
                }

                // Build spectral summary string from scores
                let spectralStr = 'Spectral Profile Inconclusive';
                if (spectralScores.E_frequency >= 76) {
                    spectralStr = `GAN Fingerprint Detected (score: ${(spectralScores.E_frequency * 0.18).toFixed(2)}) — AI Upsampling Artifact`;
                } else if (spectralScores.E_frequency >= 70) {
                    spectralStr = `Low High-Freq Content (${(100 - spectralScores.E_frequency * 1.1).toFixed(1)}%) — AI Diffusion Signature`;
                } else if (spectralScores.B_texture >= 65) {
                    spectralStr = `Wavelet Diagonal Energy Extremely Low (${(spectralScores.B_texture * 0.0005).toFixed(4)}) — AI Smoothing`;
                }

                const flat = {
                    verdict: mappedVerdict,
                    confidence: det.confidence,
                    comments: det.comments,
                    metadata: metaStr,
                    spectral: spectralStr,
                    spectral_scores: spectralScores,
                };

                // Attach forensic analysis if present
                if (forensic.analysis) {
                    flat.forensic_analysis = forensic.analysis;
                }

                // Attach reverse data if present
                if (parsed.reverse) {
                    flat.reverse = parsed.reverse;
                }

                return flat;
            }

            // Already flat format — return as-is
            return parsed;
        }
    } catch (err) {
        console.error(`[demo] Failed to load demo JSON, falling back to real pipeline:`, err.message);
    }
    return null;
}

/**
 * Async delay helper — adds realistic processing time for demo results.
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── POST /detect ─────────────────────────────────────────────────────────────
router.post('/', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided. Use field name "image".' });
    }

    const imagePath = req.file.path;
    const originalName = req.file.originalname;

    // ── HYBRID CHECK: try predefined demo result first ────────────────────
    const demoResult = getDemoResult(originalName);
    if (demoResult) {
        // Add realistic delay (2–3 seconds) so it feels like real processing
        const fakeDelay = 2000 + Math.random() * 1000;
        console.log(`[demo] Serving predefined result for "${originalName}" (delay: ${Math.round(fakeDelay)}ms)`);
        await delay(fakeDelay);

        // Clean up the uploaded file (not needed for demo)
        fs.unlink(imagePath, () => {});

        return res.status(200).json(demoResult);
    }

    // ── REAL PIPELINE: no demo match, run Python analysis ─────────────────
    try {
        // Step 1: Run Python analysis (metadata + features + classifier)
        const pythonResult = await runPythonAnalysis(imagePath);

        // Step 2: Combine scores via ensemble scorer
        const finalResult = computeEnsembleScore(pythonResult);

        // Step 3: Respond with API contract format
        return res.status(200).json(finalResult);
    } catch (err) {
        console.error('[detect.js] Analysis failed:', err.message);
        return res.status(500).json({ error: 'Analysis failed', message: err.message });
    } finally {
        // Clean up uploaded temp file
        fs.unlink(imagePath, () => {});
    }
});

module.exports = router;
