import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn("GEMINI_API_KEY is not set. AI features will not work.");
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY || "" });

export const executeCommandTool: FunctionDeclaration = {
  name: "execute_shell_command",
  description: "Executes a shell command on the user's remote Termux terminal and returns the output. Note: The current working directory is the 'workspace/' folder.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      command: {
        type: Type.STRING,
        description: "The shell command to execute (e.g. 'ls', 'pkg install nodejs', 'cat myfile.ts')."
      },
      reason: {
        type: Type.STRING,
        description: "Briefly explain why this command is being run."
      }
    },
    required: ["command", "reason"]
  }
};

export const writeFileTool: FunctionDeclaration = {
  name: "write_file",
  description: "Writes content to a file on the user's remote Termux storage. Files should be relative to the 'workspace/' directory.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: {
        type: Type.STRING,
        description: "The file path (e.g., 'projects/myapp/index.js')."
      },
      content: {
        type: Type.STRING,
        description: "The content to write to the file."
      }
    },
    required: ["path", "content"]
  }
};

export async function getGeminiResponse(
  messages: any[],
  onFunctionCall: (name: string, args: any) => Promise<any>,
  modelName: string = "gemini-3.1-pro-preview"
) {
  const chatConfig = {
    model: modelName,
    config: {
      systemInstruction: `You are Termux Code Genius, an expert terminal assistant for mobile devices running Termux.
      Your goal is to help users code, manage files, and automate tasks through their terminal.
      - IMPORTANT: All coding projects and file creations MUST happen inside the 'workspace/' directory.
      - NEVER modify files in the root directory unless explicitly asked, as this will reload the application.
      - Before building a new app or project, create a sub-folder inside 'workspace/'.
      - You can execute shell commands and write files using provided tools.
      - Always verify if a directory exists before writing multiple files.
      - Provide helpful context for each command.
      - Be concise and efficient.
      - If you need to install packages, use 'pkg install -y <package>'.`,
      tools: [{ functionDeclarations: [executeCommandTool, writeFileTool] }],
    },
  };

  const chat = ai.chats.create(chatConfig);
  const lastMessage = messages[messages.length - 1];
  const history = messages.slice(0, -1).map(m => ({
    role: m.role,
    parts: [{ text: m.content }]
  }));

  try {
    let result = await chat.sendMessage({
      message: lastMessage.content,
      // Pass history if needed, but the Chat object maintains state if used correctly
      // For simplicity in this demo, we'll just send the message
    });

    let functionCalls = result.functionCalls;
    
    // Handle sequential function calling loop (basic version)
    let currentResponse = result;
    while (functionCalls) {
      const toolResponses = [];
      for (const call of functionCalls) {
        const responseData = await onFunctionCall(call.name, call.args);
        toolResponses.push({
          functionResponse: {
            name: call.name,
            response: { result: responseData },
          }
        });
      }

      // Send the tool results back to the model
      currentResponse = await chat.sendMessage({
        message: toolResponses
      });
      functionCalls = currentResponse.functionCalls;
    }

    return currentResponse.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    throw error;
  }
}
