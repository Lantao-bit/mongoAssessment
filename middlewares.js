const jwt = require('jsonwebtoken');

// all middlewares in Express are functions that take in three parameters
// req -> request
// res -> response
// next -> the next middleware to call 

function verifyToken(req, res, next) {
    // check if the JWT is provided in the authorization headers 
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) {
        // send status 401 back without a message
        return res.sendStatus(401);
    }

    // first parameter: token from the request's header
    // second parameter: the secret key (aka TOKEN SECRET)
    // third parameter: callback function, called when the verification has finished
    jwt.verify(token, process.env.TOKEN_SECRET, function (err, tokenData) {
        if (err) {
            return res.sendStatus(401);
        } else {
            // a middleware can add new keys to request
            req.tokenData = tokenData;

            // If the JWT is valid, transfer the request to the next middleware
           next();
        }
    })
}

module.exports = { verifyToken}