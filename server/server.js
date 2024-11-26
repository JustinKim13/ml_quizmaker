const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");
const cors = require("cors");

// Define file paths at the top
const QUESTIONS_FILE = path.join(__dirname, "ml_models/models/questions.json");
const UPLOAD_DIR = path.join(__dirname, "ml_models/data_preprocessing/pdf_files");
const STATUS_FILE = path.join(__dirname, "ml_models/models/status.json");
const COMBINED_OUTPUT_FILE = path.join(__dirname, "ml_models/outputs/combined_output.txt");

let questionsGenerated = false;

const app = express();
app.use(cors());
app.use(express.json());

// Storage configuration for multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(UPLOAD_DIR)) {
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        }
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    },
});

const upload = multer({ storage });

// Add this middleware before multer processes the files
app.post("/api/upload", (req, res, next) => {
    // Clear PDF directory first
    if (fs.existsSync(UPLOAD_DIR)) {
        fs.readdirSync(UPLOAD_DIR).forEach((file) => {
            const filePath = path.join(UPLOAD_DIR, file);
            fs.unlinkSync(filePath);
            console.log(`Cleared PDF: ${filePath}`);
        });
    }
    next();
}, upload.array("files", 5), async (req, res) => {
    try {
        console.log("Upload endpoint hit");
        const files = req.files;
        const videoUrl = req.body.videoUrl || '';
        
        console.log("Files received:", files);
        console.log("Video URL received:", videoUrl);
        
        // Clear combined output and reset status
        if (fs.existsSync(COMBINED_OUTPUT_FILE)) {
            fs.writeFileSync(COMBINED_OUTPUT_FILE, '');
        }
        
        fs.writeFileSync(QUESTIONS_FILE, JSON.stringify({ questions: [] }));

        // Process PDFs first if they exist
        if (files && files.length > 0) {
            fs.writeFileSync(STATUS_FILE, JSON.stringify({
                status: 'processing',
                timestamp: new Date().toISOString(),
                message: 'Reading PDF files...'
            }));
            
            try {
                await processPdfFiles(files.map(f => f.path));
            } catch (error) {
                console.error("Error processing PDFs:", error);
                throw error;
            }
        }

        // Then process video if URL exists
        if (videoUrl.trim()) {
            fs.writeFileSync(STATUS_FILE, JSON.stringify({
                status: 'processing',
                timestamp: new Date().toISOString(),
                message: 'Processing video content...'
            }));
            
            try {
                await processVideoUrl(videoUrl);
            } catch (error) {
                console.error("Error processing video:", error);
                throw error;
            }
        }

        // Update status for question generation
        fs.writeFileSync(STATUS_FILE, JSON.stringify({
            status: 'processing',
            timestamp: new Date().toISOString(),
            message: 'Generating quiz questions...'
        }));

        // Generate questions
        try {
            await generateQuestions();
            res.status(200).json({ message: "Processing completed" });
        } catch (error) {
            console.error("Error generating questions:", error);
            throw error;
        }

    } catch (error) {
        console.error("Error in upload endpoint:", error);
        fs.writeFileSync(STATUS_FILE, JSON.stringify({
            status: 'error',
            timestamp: new Date().toISOString(),
            message: `Error: ${error.message}`
        }));
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

app.get("/api/status", (req, res) => {
    try {
        if (fs.existsSync(STATUS_FILE)) {
            const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
            console.log("Current status:", status);
            
            // Only set questionsGenerated to true if status is 'completed' AND we have questions
            if (status.status === 'completed') {
                const questionsData = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
                const questionsGenerated = questionsData.questions && questionsData.questions.length > 0;
                res.status(200).json({ 
                    questionsGenerated,
                    status: questionsGenerated ? 'completed' : 'processing',
                    message: status.message,
                    timestamp: status.timestamp
                });
            } else {
                res.status(200).json({ 
                    questionsGenerated: false,
                    status: status.status,
                    message: status.message,
                    timestamp: status.timestamp
                });
            }
        } else {
            res.status(200).json({ 
                questionsGenerated: false,
                status: 'unknown',
                message: 'Starting...'
            });
        }
    } catch (error) {
        console.error("Error checking status:", error);
        res.status(500).json({ 
            questionsGenerated: false,
            status: 'error',
            message: error.message
        });
    }
});

app.get("/api/questions", (req, res) => {
    console.log("Reading questions from:", QUESTIONS_FILE);
    
    fs.readFile(QUESTIONS_FILE, "utf8", (err, data) => {
        if (err) {
            console.error("Error reading questions file:", err);
            return res.status(500).json({
                error: "Error reading questions file",
                details: err.message
            });
        }

        try {
            const questionsData = JSON.parse(data);
            console.log("Sending questions data:", questionsData);
            res.status(200).json(questionsData);
        } catch (parseError) {
            console.error("Error parsing questions:", parseError);
            res.status(500).json({
                error: "Error parsing questions",
                details: parseError.message
            });
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    res.status(500).json({
        error: 'Server error',
        details: err.message
    });
});

// Start server
app.listen(5000, () => {
    console.log("Server running on port 5000");
});

// Modify the generateQuestions function
const generateQuestions = async () => {
    console.log("Starting generateQuestions function...");
    
    // Reset status at start
    fs.writeFileSync(STATUS_FILE, JSON.stringify({
        status: 'starting',
        timestamp: new Date().toISOString()
    }));

    return new Promise((resolve, reject) => {
        const pythonScript = path.join(__dirname, "ml_models/models/t5_model.py");
        console.log("Running Python script:", pythonScript);
        
        const pythonProcess = exec(`python3 ${pythonScript}`, (error, stdout, stderr) => {
            if (error) {
                console.error("Error executing Python script:", error);
                reject(error);
                return;
            }
            if (stderr) {
                console.log("Python stderr:", stderr);
            }
            console.log("Python stdout:", stdout);
            
            // Check final status
            try {
                const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
                questionsGenerated = status.status === 'completed';
                resolve(stdout);
            } catch (err) {
                console.error("Error reading final status:", err);
                reject(err);
            }
        });

        // Log real-time output
        pythonProcess.stdout.on('data', (data) => {
            console.log(`Python output: ${data}`);
        });

        pythonProcess.stderr.on('data', (data) => {
            console.log(`Python error: ${data}`);
        });
    });
};

// Helper function to process video URL
function processVideoUrl(videoUrl) {
    return new Promise((resolve, reject) => {
        const pythonScript = path.join(__dirname, "ml_models/data_preprocessing/extract_text_url.py");
        const pythonProcess = spawn('python3', [pythonScript]);

        // Write the URL to the Python script's stdin
        pythonProcess.stdin.write(videoUrl + '\n');
        pythonProcess.stdin.end();

        pythonProcess.stdout.on('data', (data) => {
            console.log('Video Processing output:', data.toString());
        });

        pythonProcess.stderr.on('data', (data) => {
            console.error('Video Processing error:', data.toString());
        });

        pythonProcess.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Video processing failed with code ${code}`));
            }
        });
    });
}

// Helper function to process PDF files
function processPdfFiles(pdfFiles) {
    return new Promise((resolve, reject) => {
        const pythonScript = path.join(__dirname, "ml_models/data_preprocessing/extract_text_pdf.py");
        const pdfFilesArg = pdfFiles.join(",");
        
        const pythonProcess = spawn('python3', [pythonScript, pdfFilesArg]);

        pythonProcess.stdout.on('data', (data) => {
            console.log('PDF Processing output:', data.toString());
        });

        pythonProcess.stderr.on('data', (data) => {
            console.error('PDF Processing error:', data.toString());
        });

        pythonProcess.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`PDF processing failed with code ${code}`));
            }
        });
    });
}
