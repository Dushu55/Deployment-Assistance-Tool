const crypto = require('crypto');
const express = require('express');

const app = express();

app.get('/hash', (req, res) => {
    // INSECURE: MD5 hashing
    const hash = crypto.createHash('md5').update(req.query.data).digest('hex');
    res.send(hash);
});

app.get('/execute', (req, res) => {
    // INSECURE: eval with user input
    const userInput = req.query.code;
    const result = eval(userInput); 
    res.send(result);
});

// Hardcoded AWS Key
const AWS_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";

app.listen(3000);