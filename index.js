// REQUIRES
const express = require('express');
require('dotenv').config();  // put the variables in the .env file into process.env
const cors = require('cors');
const { connect } = require("./db");
const { ObjectId } = require('mongodb');
const { BSONError } = require('mongodb/lib/bson'); // Import the internal BSONError
const { ai, generateSearchParams, generateRecipe, translateRecipe } = require('./gemini');
//const e = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { verifyToken } = require("./middlewares");

// SETUP EXPRESS
const app = express();
app.use(cors()); // enable CORS for API
app.use(express.json()); // tell Express that we are sending and reciving JSON

// generate JWT upon successful login 
function generateAccessToken(id, email) {
    // jwt.sign creates a JWT
    // first parameter -> object payload, or token data, the data that is in the JWT (i.e "claims")
    // second parameter -> your secret key
    // third parameter -> options object
    return jwt.sign({
        "user_id": id,
        "email": email
    }, process.env.TOKEN_SECRET, {
        // m = minutes, h = hours, s = seconds, d = days, w = weeks
        "expiresIn": "2w"
    });
}

// SETUP DATABASE
const mongoUri = process.env.MONGO_URI;   //from Compass cluster connection string 
const dbName = "recipe_book";

// Validate recipe for POST and PUT
async function validateRecipe(db, request) {
    const { name, cuisine, prepTime, cookTime, servings, ingredients, instructions, tags } = request;

    // basic validation - all components are provided 
    if (!name || !cuisine || !ingredients || !instructions || !tags || !prepTime || !cookTime || !servings) {
        return {
            "success": false,
            "error": "Missing fields",
        }
    }

    // validate the cuisine
    const cuisineDoc = await db.collection('cuisines').findOne({
        name: cuisine
    });

    if (!cuisineDoc) {
        return {
            "success": false,
            "error": "Invalid cuisine"
        }
    }

    // validate the tags

    // find the tags from the database
    const tagDocs = await db.collection('tags').find({
        "name": {
            $in: tags
        }
    }).toArray();

    // check if the number of tags that we have found matches the length of the tags array
    if (tagDocs.length != tags.length) {
        return {
            success: false,
            error: "One or more tags is invalid"
        }
    }

    const newRecipe = {
        name,
        cuisine: {
            _id: cuisineDoc._id,
            name: cuisineDoc.name
        },
        prepTime,
        cookTime,
        servings,
        ingredients,
        instructions,
        tags: tagDocs
    }

    return {
        success: true,
        newRecipe: newRecipe,
        error: null
    }

}

// main function for routes 
async function main() {
    const db = await connect(mongoUri, dbName);

    // ROUTES - default
    app.get('', function (req, res) {
        res.json({
            "message": "Hello world"
        })
    });

    // READ: recipes Search using Query String parameter
    // example: ?name=chicken&tags=popular,spicy&ingredients=chicken,yogurt

    app.get('/recipes/search', async function (req, res) {
        //    console.log(req.query);
        const name = req.query.name;
        const tags = req.query.tags;
        const ingredients = req.query.ingredients;

        const criteria = {};     //get all recipes if criteria is an empty object 

        // search criteria:  by string patterns using regular expression
        if (name) {
            criteria["name"] = {
                $regex: name,
                $options: "i"
            }
        }

        // search criteria: by tags
        if (tags) {
            criteria["tags.name"] = {
                $in: tags.split(",")
            }
        }

        // search criteria:  use $all with regular expressions
        //   using arrow function to convert a comma-separated string 
        //   into array of case insenstive regular expression objects:

        if (ingredients) {
            const regularExpressionArray = ingredients.split(",").map(
                ingredient => new RegExp(ingredient, 'i')
            );

            criteria['ingredients.name'] = {
                $all: regularExpressionArray
            }
        }

        // debug search criteria in case of doubt
        console.log(criteria);

        // search recipes: only limited recipe info is present including _Id object
        try {
            const recipes = await db.collection('recipes').find(criteria).project({
                name: 1, cuisine: 1, tags: 1, prepTime: 1
            }).toArray();
            res.json({
                "recipes": recipes
            })
        } catch (error) {
            console.error("Error fetching recipes:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    })

    // READ a recipe detail by ID via query string, example ?id=695f64e320c0ab9c7a35125d 
    app.get('/recipes/detail', async function (req, res) {
        try {
            const recipeId = req.query.id;
            const recipe = await db.collection('recipes').findOne(
                { _id: new ObjectId(recipeId) },
                { projection: { _Id: 0 } });

            if (!recipe) {
                return res.status(404).json({ error: "recipe not found." });
            }
            res.json({ recipe });
        } catch (error) {

            // Handles cases where the provided recipeId is not a valid ObjectId format
            if (error instanceof BSONError) {
                return res.status(400).json({ error: "Invalid recipe ID format." });
            }
            console.error("Error fetching recipe:", error);
            res.status(500).json({ error: "Internal server error" });

        }
    })

    // CREATE (post) recipe  
    app.post('/recipes/create', async function (req, res) {
        // use object destructuring to extract each components from req.body
        const { name, cuisine, prepTime, cookTime, servings, ingredients, instructions, tags } = req.body;

        // basic validation to ensure that all components are available 
        if (!name || !cuisine || !ingredients || !instructions || !tags || !prepTime || !cookTime || !servings) {
            // HTTP 400 error code = Bad request
            return res.status(400).json({
                error: "Missing required fields"
            })
        }

        // validate the cuisine
        const cuisineDoc = await db.collection('cuisines').findOne({
            name: cuisine
        });

        if (!cuisineDoc) {
            return res.status(400).json({
                error: "Error. Cuisine not found"
            })
        }

        // validate the tags - find the tags from the database
        const tagDocs = await db.collection('tags').find({
            "name": {
                $in: tags
            }
        }).toArray();

        // validate the tags - check if the number of tags provided = that of tags found
        if (tagDocs.length != tags.length) {
            return res.status(400).json({
                'error': "One or more tags is invalid"
            })
        }

        // prepare the recipe object
        const newRecipe = {
            _id: new ObjectId(),  // optional, 'cos when Mongo inserts a new document, it will ensure that an _id
            name,
            cuisine: {
                _id: cuisineDoc._id,
                name: cuisineDoc.name
            },
            prepTime,
            cookTime,
            servings,
            ingredients,
            instructions,
            tags: tagDocs
        }

        // create the recipe in database 
        try {
            const result = await db.collection('recipes').insertOne(newRecipe);
            res.status(201).json({
                message: "Recipe created",
                recipeId: result.insertedId
            })
        } catch (error) {
            console.error("Error fetching recipe:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    })

    // UPDATE(put) a recipe via id parameter, example: /recipes/695f64e320c0ab9c7a35125d
    //.  new recipe is provide as an object in the PUT request body
    app.put('/recipes/update/:id', async function (req, res) {
        try {
            const recipeId = req.params.id;
            console.log(recipeId);
            const status = await validateRecipe(db, req.body);
            if (status.success) {
                // update the recipe
                const result = await db.collection('recipes').updateOne(
                    { _id: new ObjectId(recipeId) },
                    { $set: status.newRecipe });

                if (result.matchedCount === 0) {
                    return res.status(404).json({ error: 'Recipe not found' });
                }

                res.json({
                    'message': "Recipe has been updated successful"
                })
            } else {
                res.status(400).json({
                    error: status.error
                })
            }
        } catch (error) {
            console.error('Error updating recipe:', error);
            res.status(500).json({ error: 'Internal server error' });
        }

    })
    // DELETE recipe via id parameter, exmple: /recipes/<ID from database or search result>
    app.delete('/recipes/delete/:id', async function (req, res) {
        try {
            const recipeId = req.params.id;
            const results = await db.collection('recipes').deleteOne({
                _id: new ObjectId(recipeId)
            });

            if (results.deletedCount === 0) {
                return res.status(404).json({
                    "error": "Not found"
                })
            }

            res.json({
                'message': 'Deleted successfully'
            })
        } catch (e) {
            res.status(500).json({
                'error': 'Internal Server Error'
            })
        }

    })

    // REVIEW (post) recipe, example /recipes/695f64e320c0ab9c7a35125d/reviews
    app.post('/recipes/:id/reviews', async (req, res) => {
        try {
            const recipeId = req.params.id;
            const { user, rating, comment } = req.body;

            // Basic validation
            if (!user || !rating || !comment) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            // Create the new review object
            const newReview = {
                review_id: new ObjectId(),
                user,
                rating: Number(rating),
                comment,
                date: new Date()
            };

            // Add the review to the recipe
            const result = await db.collection('recipes').updateOne(
                { _id: new ObjectId(recipeId) },
                { $push: { reviews: newReview } }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ error: 'Recipe not found' });
            }

            res.status(201).json({
                message: 'Review added successfully',
                reviewId: newReview.review_id
            });
        } catch (error) {
            console.error('Error adding review:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });


    // Usecase - recipe search using natural language and translation  
    // 1. Call AI to convert user's natural multilingual languages query into a structured search params 
    //    in English using available tags, cuisines and ingredients avaiable from database. 
    // 2. Prompt AI in the same call to infer the main user language from the query      
    // 3. Find receipts from MongoDB using criteria formed from the above AI response
    // 4. Call AI to translate the recipes into human friendly format in user language 
    app.get('/ai/recipes', async function (req, res) {
        const query = req.query.q;

        const allCuisines = await db.collection('cuisines').distinct('name');
        const allTags = await db.collection('tags').distinct('name');
        const allIngredients = await db.collection('recipes').distinct('ingredients.name');

        // call AI to generate strutured search parameters
        const searchParams = await generateSearchParams(query, allTags, allCuisines, allIngredients);
        const criteria = {};

        if (searchParams.cuisines && searchParams.cuisines.length > 0) {
            criteria["cuisine.name"] = {
                $in: searchParams.cuisines
            }
        }

        if (searchParams.ingredients && searchParams.ingredients.length > 0) {
            criteria["ingredients.name"] = {
                $all: searchParams.ingredients
            }
        }

        if (searchParams.tags && searchParams.tags.length > 0) {
            criteria['tags.name'] = {
                $in: searchParams.tags
            }
        }

        const userLanguage = searchParams.userLanguage;
        const recipes = await db.collection('recipes').find(criteria).toArray();

        // call AI to translate recipes
        console.log(userLanguage);
        const translatedRecipe = await translateRecipe(recipes, userLanguage);
        console.log(translatedRecipe);

        res.send(`${translatedRecipe}`)   
    })

    // Use AI to generte a structured recipe from user's natural langauage description 
    app.post('/ai/recipes', async function (req, res) {
        // recipe text from the request body
        const recipeText = req.body.recipeText; 
        const allCuisines = await db.collection('cuisines').distinct('name');
        const allTags = await db.collection('tags').distinct('name');

        // call AI to generate the recipe 
        const newRecipe = await generateRecipe(recipeText, allCuisines, allTags);

        // get the cuisine document
        const cuisineDoc = await db.collection('cuisines').findOne({
            "name": newRecipe.cuisine
        });

        if (cuisineDoc) {
            newRecipe.cuisine = cuisineDoc;
        } else {
            return res.status(404).json({
                "error": "AI tried to use a cuisine that doesn't exist"
            })
        }

        // get all the tags that corresponds 
        const tagDocs = await db.collection('tags').find({
            'name': { $in: newRecipe.tags }
        }).toArray();
        newRecipe.tags = tagDocs;

        // insert into the database
        const result = await db.collection('recipes').insertOne(newRecipe);
        res.json({ recipeId: result.insertedId })
    })

    // User register, password is hashed and stored
    // sample request body
    // {  "email":"test456@gemail.com",
    //    "password": "rotiprata"        }
    app.post('/users', async function (req, res) {
        const result = await db.collection('users')
            .insertOne({
                "email": req.body.email,
                "password": await bcrypt.hash(req.body.password, 12)
            });

        res.json({
            message: "New user has been create has been created successfully",
            userId: result.insertedId
        })
    })

    // User login, and JWT created and returned  
    // sample POST body
    // {   "email":"test456@gemail.com",
    //      "password":"rotiprata".       }
    app.post('/login', async function (req, res) {
        const { email, password } = req.body;     // eamil id & password from request

        // retrieve user email id and hashed password from databae  
        const user = await db.collection("users").findOne({ "email": email });

        // when user is found, compare password: plain text vs hashed 
        // the bcrypt.compar returns true if they are the same
        if (user) {
            const isPasswordValid = await bcrypt.compare(password, user.password);
            if (isPasswordValid) {
                // generate JWT
                const accessToken = generateAccessToken(user._id, user.email)

                // send back JWT
                res.json({ accessToken })
            } else { return res.status(401).json({ 'error': 'Invalid login' }) }
        } else { return res.status(401).json({ 'error': 'Invalid login' }) }
    })

    // example to use JWT to protect route access 
    // The access token will be in the request's header, in the Authorization field
    // the format will be "Bearer <JWT>"
    app.get('/protected', verifyToken, function (req, res) {
        const tokenData = req.tokenData; // added by the verifyToken middleware
        res.json({
            "message": "This is a secret message",
            tokenData
        })
    })
}

main();


// START SERVER
app.listen(3000, function () {
    console.log("Server has started");
})