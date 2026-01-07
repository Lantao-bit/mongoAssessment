require('dotenv').config(); // read the GEMINI_API_KEY and the GEMINI_MODEL from the .env file
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash"



// first parameter - the query (the natural language query ), "I want to cook something using chicken and yogurt"
// second parameter - tags: all the possible tags
// third parameter - cuisines: all the cuisines
// fourth parameter - ingrediebnts: all the ingredients in the database
async function generateSearchParams(query, tags, cuisines, ingredients) {
    const systemPrompt = `You are a search query converter. Convert the user's natural language query into a structured
 search format. Here are all the available tags, cuisines and ingredients



 Output: A JSON object with the following fields, ONLY using values from the available lists above and empty arrays 
 if no values apply:
 {
  "cuisine": string[],
  "tags": string[],
  "ingredients": string[]
 }

 - tags: array of strings of matching tags (OR logic - recipe has ANY of them)
 - cuisines: array of cuisines (OR logic - recipe has ANY of them)
 - ingredients: array of string of ingredients (AND logic - recipe must have ALL of them)

 Rules:
 - only use tags from the available list
 - only use cuisines from the available list
 - For ingredients, extract and infer any food items mentioned
 - Keep values for ingredients lowercase but for cuisine uppercase
 - Return ONLY valid JSON, no explanations and no code fences
 - Apply semantic understand - infer the tags, cuisines and ingredients from the query. Example:
 - Meat can mean chicken, beef or duck
 - Use association if possible.
  If the query mentions a cuisine, infer the cuisine or the closest match from the available cuisines list.
- If the query mentions an ingredient, infer the ingredient or the closest match from the available ingredients list.
- If the query mentions a tag, infer the tag or the closest match from the available tags list.
- Infer cuisines and ingredients from tags
- Infer tags from cuisines and ingredients
Example input: "italian pasta with chicken and garlic"
Example output: {"cuisines":["Italian"],"ingredients":["chicken","garlic"]}

Example input: "southeast asian recipes"
Example output: {"cuisines":["Thai","Vietnamese","Chinese","Indian"]}

Example input: "quick no meat dinner"
Example output: {"tags":["quick","easy","vegetarian","vegan","dinner"]}

Example input: "healthy thai soup with coconut and lemongrass"
Example output: {"cuisines":["Thai"],"ingredients":["coconut","lemongrass"],"tags":["healthy","light"]}

User's query: ${query}
 Available Tags: ${tags}
 Available Cuisines: ${cuisines}
 Available Ingredients: ${ingredients}

 `
    const aiResponse = await ai.models.generateContent({
        model: MODEL,
        contents: systemPrompt,
        config: {
            responseMimeType: "application/json",
            responseJsonSchema: {
                "type": "object",
                "properties": {
                    "ingredients": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        }
                    },
                    "tags": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        }
                    },
                    "cuisines": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        }
                    }
                },
                "required": [
                    "ingredients",
                    "tags",
                    "cuisines"
                ]
            }
        }
    })

    const searchParams = JSON.parse(aiResponse.text);
    return searchParams;
}

async function generateRecipe(recipeText, availableCuisines, availableTags) {
    const systemPrompt = `You are a recipe parser. Convert the user's natural language recipe description into a structured recipe format.

Available cuisines: ${availableCuisines.join(', ')}
Available tags: ${availableTags.join(', ')}

Parse the recipe and output a JSON object with the following structure:
{
  "name": string,
  "cuisine": string (must be from available cuisines list),
  "prepTime": number (in minutes),
  "cookTime": number (in minutes),
  "servings": number,
  "ingredients": array of objects with structure { "name": string, "quantity": string, "unit": string },
  "instructions": array of strings (step-by-step),
  "tags": array of strings (must be from available tags list)
}

Rules:
- Extract recipe name from the text (use proper capitalization)
- Choose the most appropriate cuisine from the available list (use proper capitalization)
- Infer prep time and cook time if not explicitly stated
- Parse ingredients with name, quantity, and unit (ingredient names in lowercase)
- Break down instructions into clear steps (use proper sentence case with capital first letter and periods)
- Select relevant tags from the available list based on the recipe characteristics (tags in lowercase)
- Use proper English grammar and capitalization
- Return ONLY valid JSON, no explanation

Example input: "Make a quick Italian pasta carbonara. You'll need 400g spaghetti, 200g bacon, 4 eggs, 100g parmesan, and black pepper. First, cook the pasta. While it cooks, fry the bacon until crispy. Beat the eggs with parmesan. Drain pasta, mix with bacon, then stir in egg mixture off heat. Serves 4, takes about 30 minutes total."

Example output: {
  "name": "Pasta Carbonara",
  "cuisine": "Italian",
  "prepTime": 10,
  "cookTime": 20,
  "servings": 4,
  "ingredients": [
    {"name": "spaghetti", "quantity": "400", "unit": "g"},
    {"name": "bacon", "quantity": "200", "unit": "g"},
    {"name": "eggs", "quantity": "4", "unit": "whole"},
    {"name": "parmesan", "quantity": "100", "unit": "g"},
    {"name": "black pepper", "quantity": "to taste", "unit": ""}
  ],
  "instructions": [
    "Cook the pasta according to package directions.",
    "Fry the bacon until crispy.",
    "Beat the eggs with parmesan cheese.",
    "Drain the pasta and mix with bacon.",
    "Remove from heat and stir in egg mixture."
  ],
  "tags": ["quick", "easy", "italian"]
}

Recipe Text: ${recipeText}
`;

    const aiResponse = await ai.models.generateContent({
        model: MODEL,
        contents: systemPrompt,
        config: {
            responseMimeType: "application/json",
            responseJsonSchema: {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string"
                    },
                    "cuisine": {
                        "type": "string"
                    },
                    "prepTime": {
                        "type": "number"
                    },
                    "cookTime": {
                        "type": "number"
                    },
                    "servings": {
                        "type": "number"
                    },
                    "ingredients": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {
                                    "type": "string"
                                },
                                "quantity": {
                                    "type": "string"
                                },
                                "unit": {
                                    "type": "string"
                                }
                            },
                            "required": [
                                "name",
                                "quantity",
                                "unit"
                            ]
                        }
                    },
                    "instructions": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        }
                    },
                    "tags": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        }
                    }
                },
                "required": [
                    "name",
                    "cuisine",
                    "prepTime",
                    "cookTime",
                    "servings",
                    "ingredients",
                    "instructions",
                    "tags"
                ]
            }
        }
    });

    const generatedRecipe = JSON.parse(aiResponse.text);

    return generatedRecipe;

}

module.exports = {
    ai, MODEL, generateSearchParams, generateRecipe
}