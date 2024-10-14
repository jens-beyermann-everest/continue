import { SlashCommand } from "../../";


function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applySearchReplacePairs(input: any, pairs: any) {
  let result = input;
  for (const [search, replace] of pairs) {
    const searchRegex = new RegExp(escapeRegExp(search), "g");
    result = result.replace(searchRegex, replace);
  }

  return result;
}

async function generateSearchReplace(
  fileContent:string, 
  originalPrompt: string, 
  answer: string, 
  contextItems: any[], // TODO: Should we also respect content from other files in the prompt context. 
  input: string, // TODO: Should user requests be included here? something like e.g.:  "/merge merge specialFunction at position x".
  llm: any,
  history: any,
 ): Promise<string> {

console.log("DEBUG: HISTORY", history);

const prompt = `
You are observing a conversation of a software developer and an AI coding assistant. 
The software developer provides files containing a selection of the current codebase. 
Then he requests the AI coding assistant to propose code to realize some changes.
Analyze the proposed code changes and the original files. 
Provide a number of search and replace statements that apply the proposed code changes to the original file. 
Make the search statements as short and precise as possible but extensive enough the search statement is always unique in the original file.

1. (File with original codebase)
${fileContent}

2. (Requested changes)
${originalPrompt}

3. (proposed code changes from the AI assistant)
${answer}

4. (additional communication between the developer and the developer and the coding assistant)
${history}

The search and replace statements should have the following format:


[SEARCH]
Code to be replaced (with sufficient context to make it unique)
[/SEARCH]
[REPLACE]
New code to insert
[/REPLACE]

[SEARCH]
Another Code piece to be replaced (with sufficient context)
[/SEARCH]
[REPLACE]
New code piece to insert
[/REPLACE]

...

IMPORTANT: ONLY RETURN CODE INSIDE THE [SEARCH] AND [REPLACE] TAGS. DO NOT INCLUDE ANY OTHER TEXT, COMMENTS, or Explanations. FOR EXAMPLE:
[SEARCH]
function oldFunction() {}
[/SEARCH]
[REPLACE]
function newFunction() {
    console.log("New Functionality");
}
[/REPLACE]

In case you add new content include sufficient context to specify the position of the new code uniquely.
[SEARCH]
function someFunction() {}
const someVariable='value';


[/SEARCH]
[REPLACE]
function someFunction() {}
const someVariable='value';

 
function newFunction() {}
[/REPLACE]
`;
  
  // console.log("prompt:\n\n", prompt);
  const response = await llm.complete(prompt);
  // console.log("response:\n\n",response);
  return response;
};

function parseSearchReplace(input: string): Array<[string, string]>{
  const regex = /\[SEARCH\]([\s\S]*?)\[\/SEARCH\]\s*\[REPLACE\]([\s\S]*?)\[\/REPLACE\]/g;
  const pairs: Array<[string, string]> = [];

  let match;
  while ((match = regex.exec(input)) !== null) {
    // console.log("MATCH FOUND!!")
    const searchCode = match[1].trim();
    const replaceCode = match[2].trim();

    pairs.push([searchCode, replaceCode]);
  }

  return pairs;
}



const MergeSlashCommand: SlashCommand = {
    name: "merge",
    description: "Merge generated code",
    // run: async function* ({ ide, llm, input, history, contextItems, params }) {
    run: async function* (sdk) {
      // const lastUserPrompt = findLast(history,(msg) => msg.role === "user");
      const lastUserPrompt = sdk.history[sdk.history.length-3];
      if (typeof lastUserPrompt === "undefined"){
        console.error("Error: Could not retrieve user prompt from continue.");
        return;
      }
      
      let lastUserPromptText: string;

      if (Array.isArray(lastUserPrompt.content)) {
        // If content is an array, concatenate all text parts
        lastUserPromptText = lastUserPrompt.content
          .filter(part => part.type === "text" && typeof part.text === "string")
          .map(part => part.text)
          .join("");
      } else if (typeof lastUserPrompt.content === "string") {
        // If content is a string, use it directly
        lastUserPromptText = lastUserPrompt.content;
      } else {
        console.error("Error: Unexpected content format in user prompt.");
        return;
      }

      const lastAssistantMessage = sdk.history[sdk.history.length-2];
      if (lastAssistantMessage === undefined) {
        console.log("Currently there is no code available to merge. Interact with your AI assistant to generate code changes.");
        return;
      }

      let lastAssistantMessageText: string;

      if (Array.isArray(lastAssistantMessage.content)) {
        // If content is an array, concatenate all text parts
        lastAssistantMessageText = lastAssistantMessage.content
          .filter(part => part.type === "text" && typeof part.text === "string")
          .map(part => part.text)
          .join("");
      } else if (typeof lastAssistantMessage.content === "string") {
        // If content is a string, use it directly
        lastAssistantMessageText = lastAssistantMessage.content;
      } else {
        console.error("Error: Unexpected content format in assistant message.");
        return;
      }

      let stringHistory = [];
      for (let i = 0; i < sdk.history.length-2; i++){
        stringHistory.push(sdk.history[i].content);
      }
      console.log("DEBUG STRINGHISTORY", stringHistory);
      
      const currentFilePath = await sdk.ide.getCurrentFile();
      if (currentFilePath === undefined) {
        console.log("Currently there is no open file to merge changes. Please open the file you want to merge your changes with.");
        return;
      }
      const originalFileContent = currentFilePath ? await sdk.ide.readFile(currentFilePath) : "";

      const modelResponse = await generateSearchReplace(
        originalFileContent, 
        lastUserPromptText, 
        lastAssistantMessageText, 
        sdk.contextItems, sdk.input, sdk.llm, stringHistory
      );
      console.log("DEBUG: Model Response", modelResponse);

      const searchReplaceTuples = parseSearchReplace(modelResponse);
      console.log("DEBUG: search and replace tuples:\n\n", searchReplaceTuples);

      const newFileContent = applySearchReplacePairs(originalFileContent, searchReplaceTuples);
      console.log("DEBUG: newFileContent", newFileContent);


      const mode: string = "apply";
      if (mode === "revert"){
        // apply new content directly to the file and use the original content to compare
        await sdk.ide.writeFile(currentFilePath, newFileContent);
        await sdk.ide.showMergeDiff?.(originalFileContent, currentFilePath);
      }
      else {
        await sdk.ide.showMergeDiff?.(newFileContent, currentFilePath);
      }
    },
  };

export default MergeSlashCommand;

