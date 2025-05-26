const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { log, logLevels } = require('./logger');

// Initialize S3 client
const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET;

// S3 utility functions
const s3Utils = {
    // Upload a file to S3
    async uploadFile(file, key) {
        try {
            const command = new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: key,
                Body: file.buffer,
                ContentType: file.mimetype
            });

            await s3Client.send(command);
            log(logLevels.INFO, 'File uploaded to S3', { key });
            return `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;
        } catch (error) {
            log(logLevels.ERROR, 'Error uploading file to S3', { error: error.message, key });
            throw error;
        }
    },

    // Get a file from S3
    async getFile(key) {
        try {
            const command = new GetObjectCommand({
                Bucket: BUCKET_NAME,
                Key: key
            });

            const response = await s3Client.send(command);
            
            // Convert the stream to a string
            const chunks = [];
            for await (const chunk of response.Body) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            return buffer.toString('utf-8');
        } catch (error) {
            log(logLevels.ERROR, 'Error getting file from S3', { error: error.message, key });
            throw error;
        }
    },

    // Delete a file from S3
    async deleteFile(key) {
        try {
            const command = new DeleteObjectCommand({
                Bucket: BUCKET_NAME,
                Key: key
            });

            await s3Client.send(command);
            log(logLevels.INFO, 'File deleted from S3', { key });
        } catch (error) {
            log(logLevels.ERROR, 'Error deleting file from S3', { error: error.message, key });
            throw error;
        }
    },

    // List files in a directory
    async listFiles(prefix) {
        try {
            const command = new ListObjectsV2Command({
                Bucket: BUCKET_NAME,
                Prefix: prefix
            });

            const response = await s3Client.send(command);
            return response.Contents || [];
        } catch (error) {
            log(logLevels.ERROR, 'Error listing files in S3', { error: error.message, prefix });
            throw error;
        }
    },

    // Get a signed URL for temporary access
    async getSignedUrl(key, expiresIn = 3600) {
        try {
            const command = new GetObjectCommand({
                Bucket: BUCKET_NAME,
                Key: key
            });

            return await getSignedUrl(s3Client, command, { expiresIn });
        } catch (error) {
            log(logLevels.ERROR, 'Error generating signed URL', { error: error.message, key });
            throw error;
        }
    },

    // Clear all files in a directory
    async clearDirectory(prefix) {
        try {
            const files = await this.listFiles(prefix);
            await Promise.all(
                files.map(file => this.deleteFile(file.Key))
            );
            log(logLevels.INFO, 'Directory cleared in S3', { prefix });
        } catch (error) {
            log(logLevels.ERROR, 'Error clearing directory in S3', { error: error.message, prefix });
            throw error;
        }
    }
};

module.exports = s3Utils; 