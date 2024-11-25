const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const cors = require("cors");

let questionsGenerated = false; // Flag to track question generation

const app = express();

app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Accept']
}));
app.use(express.json());

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Directory for uploading PDFs
const uploadFolder = path.join(__dirname, "ml_models/data_preprocessing/pdf_files");

// Clear the upload folder
const clearUploadFolder = (folderPath) => {
    fs.readdir(folderPath, (err, files) => {
        if (err) {
            console.error(`Error reading folder ${folderPath}:`, err);
            return;
        }
        files.forEach((file) => {
            const filePath = path.join(folderPath, file);
            fs.unlink(filePath, (err) => {
                if (err) {
                    console.error(`Error deleting file ${filePath}:`, err);
                }
            });
        });
    });
};

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        clearUploadFolder(uploadFolder); // Clear the folder before uploading
        cb(null, uploadFolder); // Specify the upload folder
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    },
});
const upload = multer({ storage });

// API to handle multiple file uploads and process files
app.post("/api/upload", upload.array("files", 5), (req, res) => {
    console.log("Upload endpoint hit"); // Debug log
    const { files } = req;
    const { videoUrl } = req.body;

    console.log("Files received:", files); // Debug log
    console.log("Video URL received:", videoUrl); // Debug log

    if (!files?.length && !videoUrl) {
        console.log("No files or URL provided"); // Debug log
        return res.status(400).json({
            error: "Please upload at least one file or provide a video URL."
        });
    }

    questionsGenerated = false;

    const processPDFs = () => {
        return new Promise((resolve, reject) => {
            if (files.length) {
                const filePaths = files.map((file) => path.join(uploadFolder, file.filename));
                console.log(`Processing PDF files:`, filePaths);

                // Example: Iterate through the PDFs (adapt as necessary for your Python script)
                filePaths.forEach((filePath) => {
                    exec(`python3 ml_models/data_preprocessing/extract_text_pdf.py "${filePath}"`, (err) => {
                        if (err) {
                            reject(`Error processing PDF: ${err}`);
                        } else {
                            console.log(`Processed PDF: ${filePath}`);
                        }
                    });
                });

                resolve("PDFs processed.");
            } else {
                resolve("No PDFs uploaded.");
            }
        });
    };

    const processVideo = () => {
        return new Promise((resolve, reject) => {
            if (videoUrl) {
                console.log(`Processing Video URL: ${videoUrl}`);
                exec(`python3 ml_models/data_preprocessing/extract_text_url.py "${videoUrl}"`, (err) => {
                    if (err) {
                        reject(`Error processing video URL: ${err}`);
                    } else {
                        resolve("Video processed.");
                    }
                });
            } else {
                resolve("No video URL provided.");
            }
        });
    };

    const generateQuestions = () => {
        return new Promise((resolve, reject) => {
            console.log("Generating questions...");
            exec("python3 ml_models/models/t5_model.py", (err) => {
                if (err) {
                    reject(`Error generating questions: ${err}`);
                } else {
                    questionsGenerated = true; // Mark as completed
                    resolve("Questions generated.");
                }
            });
        });
    };

    // Process files and generate questions sequentially
    processPDFs()
        .then(() => processVideo())
        .then(() => generateQuestions())
        .then(() => {
            console.log("Processing completed successfully"); // Debug log
            res.status(200).json({ 
                success: true, 
                message: "Processing started successfully" 
            });
        })
        .catch((err) => {
            console.error("Processing error:", err); // Debug log
            res.status(500).json({ 
                error: "Processing failed", 
                details: err.message || String(err) 
            });
        });
});

// API to check if questions are ready
app.get("/api/status", (req, res) => {
    res.status(200).send({ questionsGenerated });
});

app.get("/api/questions", (req, res) => {
    const questionFilePath = path.join(__dirname, "ml_models/models/questions.json");

    fs.readFile(questionFilePath, "utf8", (err, data) => {
        if (err) {
            console.error("Error reading questions file:", err);
            return res.status(500).send("Error reading questions file.");
        }

        try {
            const questions = JSON.parse(data);
            res.status(200).send({ questions });
        } catch (parseError) {
            console.error("Error parsing questions:", parseError);
            res.status(500).send("Error parsing questions.");
        }
    });
});

// Start the server
app.listen(5000, () => {
    console.log("Server running on port 5000");
});

// Add OPTIONS handling for preflight requests
app.options('*', cors());

// Add this after all your routes
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    res.status(500).json({
        error: 'Server error',
        details: err.message
    });
});
