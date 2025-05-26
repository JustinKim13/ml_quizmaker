const logLevels = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG'
};

function log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        level,
        message,
        ...data
    };
    
    console.log(JSON.stringify(logEntry));
    
    if (level === logLevels.ERROR && data.error && data.error.stack) {
        console.error(data.error.stack);
    }
}

module.exports = {
    log,
    logLevels
}; 