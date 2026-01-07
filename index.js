// REQUIRES
const express = require('express');
require('dotenv').config();  // put the variables in the .env file into process.env
const cors = require('cors');
const { connect } = require("./db");
const { ObjectId } = require('mongodb');
const { ai, generateSearchParams, generateRecipe} = require('./gemini');

// SETUP EXPRESS
const app = express();
app.use(cors()); // enable CORS for API
app.use(express.json()); // tell Express that we are sending and reciving JSON

// SETUP DATABASE
const mongoUri = process.env.MONGO_URI;   //from Compass cluster connection string 
const dbName = "recipe_book";            

// Validate recipe for POST and PUT
async function validateRecipe(db, request) {
    const { name, cuisine, prepTime, cookTime, servings, ingredients, instructions, tags } = request;

    // basic validation
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

    // /recipes Search using Query String parameter
    // example: ?name=chicken&tags=popular,spicy&ingredients=chicken,pasta
    // name - the name of the recipe of the search b
    // tags - the tags to search for using comma delimited strings
    //        example: popular,spicy
    // ingredients - the ingredients to search for using comma delimited strings
    //        example: pasta,chicken
    app.get('/recipes', async function (req, res) {
    //    console.log(req.query);
        const name = req.query.name;
        const tags = req.query.tags;
        const ingredients = req.query.ingredients;
  
        const criteria = {};     //get all recipes if criteria is an empty object  
        if (name) {
            // search by string patterns using regular expression
            criteria["name"] = {
                $regex: name,
                $options: "i"
            }
        }

        if (tags) {
            criteria["tags.name"] = {
                $in: tags.split(",")
            }
        }

        // simple search - must be exact match and is case sensitive
        // if (ingredients) {
        //     critera["ingredients.name"] = {
        //         $all: ingredients.split(",")
        //     }
        // }

        // advanced search: use $all with regular expressions
        if (ingredients) {
            // traditional way of using for...loop
            // const ingredientArray = ingredients.split(",");
            // const regularExpressionArray = [];
            // for (let ingredient of ingredientArray) {
            //     regularExpressionArray.push(new RegExp(ingredient, 'i'));
            // }

            // modern way: use .map
            // const ingredientArray = ingredients.split(",");
            // const regularExpressionArray = ingredientArray.map(function(ingredient){
            //     return new RegExp(ingredient, 'i')
            // })

            // using arrow function:
            const regularExpressionArray = ingredients.split(",").map(
                ingredient=> new RegExp(ingredient, 'i')
            );

            criteria['ingredients.name'] =  {
                $all: regularExpressionArray
            }
        }

        console.log(criteria);
        const recipes = await db.collection('recipes').find(criteria).project({
            name: 1, cuisine: 1, tags: 1, prepTime: 1
        }).toArray();
        res.json({
            "recipes": recipes
        })
    })

    // tags: ["quick", "easy", "vegetarian"]
    app.post('/recipes', async function (req, res) {
        // extract out the various components of the recipe document from req.body
        // const name = req.body.name;
        // const cuisine = req.body.cuisine;
        // const prepTime = req.body.prepTime;
        // const cookTime = req.body.cookTime;
        // const servings = req.body.servings;
        // const ingredients = req.body.ingredients;
        // const instructions = req.body.instructions;
        // const tags = req.body.tags;

        // use object destructuring to extract each components from req.body
        const { name, cuisine, prepTime, cookTime, servings, ingredients, instructions, tags } = req.body;

        // basic validation
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

        // validate the tags

        // find the tags from the database
        const tagDocs = await db.collection('tags').find({
            "name": {
                $in: tags
            }
        }).toArray();

        // check if the number of tags that we have found matches the length of the tags array
        if (tagDocs.length != tags.length) {
            return res.status(400).json({
                'error': "One or more tags is invalid"
            })
        }

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

        const result = await db.collection('recipes').insertOne(newRecipe);
        res.status(201).json({
            message: "Recipe created",
            recipeId: result.insertedId
        })
    })

    app.put('/recipes/:id', async function (req, res) {
        const recipeId = req.params.id;
        const status = await validateRecipe(db, req.body);
        if (status.success) {
            // update the recipe
            const result = await db.collection('recipes').updateOne({
                _id: new ObjectId(recipeId)
            }, {
                $set: status.newRecipe
            });
            res.json({
                'message': "Recipe has been updated successful"
            })
        } else {
            res.status(400).json({
                error: status.error
            })
        }
    })

    app.delete('/recipes/:id', async function (req, res) {
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

    app.get('/ai/recipes', async function(req,res){
        const query = req.query.q;

        const allCuisines = await db.collection('cuisines').distinct('name');
        const allTags = await db.collection('tags').distinct('name');
        const allIngredients = await db.collection('recipes').distinct('ingredients.name');

        const searchParams = await generateSearchParams(query, allTags, allCuisines, allIngredients);
        console.log(searchParams);
        const criteria = {};

        if (searchParams.cuisines && searchParams.cuisines.length > 0) {
            criteria["cuisine.name"] = {
                $in: searchParams.cuisines
            }
        }

        if (searchParams.ingredients && searchParams.ingredients.length > 0){
            criteria["ingredients.name"] = {
                $all: searchParams.ingredients
            }
        }

        if (searchParams.tags && searchParams.tags.length > 0) {
            criteria['tags.name'] = {
                $in: searchParams.tags
            }
        }

        console.log(criteria);

        const recipes = await db.collection('recipes').find(criteria).toArray();
        res.json({
            recipes
        })
    })

    app.post('/ai/recipes', async function(req,res){
        const recipeText = req.body.recipeText;
        const allCuisines = await db.collection('cuisines').distinct('name');
        const allTags = await db.collection('tags').distinct('name');
        const newRecipe = await generateRecipe(recipeText, allCuisines, allTags);
        
        // get the cuisine document
        const cuisineDoc = await db.collection('cuisines').findOne({
            "name": newRecipe.cuisine
        });

        if (cuisineDoc) {
            newRecipe.cuisine = cuisineDoc;
        } else {
            return res.status(404).json({
                "error":"AI tried to use a cuisine that doesn't exist"
            })
        }

        // get all the tags that corresponds 
        const tagDocs = await db.collection('tags').find({
            'name': {
                $in: newRecipe.tags
            }
        }).toArray();
        newRecipe.tags = tagDocs;

        // insert into the database
        const result = await db.collection('recipes').insertOne(newRecipe);
        res.json({
            recipeId: result.insertedId
        })
    })
}
main();



// START SERVER
app.listen(3000, function () {
    console.log("Server has started");
})