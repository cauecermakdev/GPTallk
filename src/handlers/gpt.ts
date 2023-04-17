import ffmpeg from "ffmpeg";
import say from "say";
import os from "os";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Message, MessageMedia, Chat } from "whatsapp-web.js";
import { chatgpt } from "../providers/openai";
import * as cli from "../cli/ui";
import config from "../config";
import Ffmpeg from "fluent-ffmpeg";

// TTS
import { ttsRequest as speechTTSRequest } from "../providers/speech";
//import { ttsRequest as awsTTSRequest } from "../providers/aws";
import { TTSMode } from "../types/tts-mode";

// Moderation
import { moderateIncomingPrompt } from "./moderation";
import axios from "axios";

// Mapping from number to last conversation id
const conversations = {};

async function boldWords(sentence: string) {
	//const sentence = "The quick brown fox jumped over the lazy dog";
	//const wordsToReplace = ["quick", "jumped", "lazy"];
	console.log(sentence);
	const apiBackGpt = process.env.BACK_GPTTALK_API_BASE_URL;
	const listWordsObjects = await axios.get(`${apiBackGpt}/words`);
	const wordsToReplace: string[] = listWordsObjects.data.map((e) => e.word);
	const wordsToReplaceCleaned = wordsToReplace.filter((elem) => elem.trim().length > 0);
	console.log(wordsToReplaceCleaned.length);
	console.log(wordsToReplaceCleaned);

	// Loop through the words to replace and replace them with asterisks
	const regex = new RegExp(`\\b(${wordsToReplaceCleaned.map((w) => w.replace(/[^\w\s]/gi, "")).join("|")})\\b`, "gi");
	const replaced = sentence.replace(regex, (match) => {
		if (wordsToReplaceCleaned.includes(match.toLowerCase())) {
			return `*_${match}_*`;
		}
		return match;
	});
	return replaced;
}

const handleMessageGPT = async (message: Message, prompt: string) => {
	try {
		// Get last conversation
		const lastConversationId = conversations[message.from];

		cli.print(`[GPT] Received prompt from ${message.from}: ${prompt}`);

		// Prompt Moderation
		if (config.promptModerationEnabled) {
			try {
				await moderateIncomingPrompt(prompt);
			} catch (error: any) {
				//message.reply(error.message);
				return;
			}
		}

		const start = Date.now();

		// Check if we have a conversation with the user
		let response: string;
		if (lastConversationId) {
			// Handle message with previous conversation
			response = await chatgpt.ask(prompt, lastConversationId);
		} else {
			// Create new conversation
			const convId = randomUUID();
			const conv = chatgpt.addConversation(convId);

			// Set conversation
			conversations[message.from] = conv.id;

			cli.print(`[GPT] New conversation for ${message.from} (ID: ${conv.id})`);

			// Pre prompt
			if (config.prePrompt != null && config.prePrompt.trim() != "") {
				cli.print(`[GPT] Pre prompt: ${config.prePrompt}`);
				const prePromptResponse = await chatgpt.ask(config.prePrompt, conv.id);
				cli.print("[GPT] Pre prompt response: " + prePromptResponse);
			}

			// Handle message with new conversation
			response = await chatgpt.ask(prompt, conv.id);
		}

		const end = Date.now() - start;

		cli.print(`[GPT] Answer to ${message.from}: ${response}  | OpenAI request took ${end}ms)`);

		// TTS reply (Default: disabled)
		// if (config.ttsEnabled) {
		// 	//message.reply(response);
		// 	message.reply("bem antes do sendvoicemessagereply");
		// 	await sendVoiceMessageReply(message, response);
		// 	message.reply("bem depois do sendvoicemessagereply");
		// 	return;
		// }

		// //teste ***************************
		// const gptTextResponse = response;
		// message.reply("antes audio buffer");
		// const audioBufferSpeech = await speechTTSRequest(gptTextResponse);
		// message.reply("passou audio buffer");

		// //return await speechTTSRequest(gptTextResponse);

		// // Check if audio buffer is valid
		// if (audioBufferSpeech == null || audioBufferSpeech.length == 0) {
		// 	message.reply(`couldn't generate audio, please contact the administrator.`);
		// 	return;
		// }
		// //message.reply("audiobufferspeech isnt null");
		// //message.reply(audioBufferSpeech.toString("base64"));

		// // Get temp folder and file path
		// //const tempFolder = os.tmpdir();
		// //const tempFilePath = path.join(tempFolder, randomUUID() + ".opus");

		// // Save buffer to temp file
		// //fs.writeFileSync(tempFilePath, audioBufferSpeech);

		// // Send audio
		// message.reply(audioBufferSpeech.toString("base64"));
		// const messageMedia = new MessageMedia("audio/ogg; codecs=opus", audioBufferSpeech.toString("base64"));
		// message.reply(messageMedia);
		// //********************************** */

		// Default: Text reply
		//message.reply("aqui");

		//deixar negrito as palavras que eu nao sei que pedi para colocar na resposta
		const respondeBoldWords = await boldWords(response);
		message.reply(respondeBoldWords);

		//say.speak(response, "Alex", 1);
		// Export spoken audio to a WAV file
		// say.export(response, "Alex", 1, "./src/audioGenarated/test.wav", (err) => {
		// 	if (err) {
		// 		return console.error(err);
		// 	}

		// 	console.log("Text has been saved to hal.wav.");
		// });

		//converter wav to base64
		//passa pra MessageMedia

		// Read the audio file as a binary buffer
		//const audioBuffer = fs.readFileSync("./src/audioGenarated/1.opus");
		//console.log("audioBuffer");
		//console.log(audioBuffer);

		// Convert the binary buffer to a base64 string
		//const base64Audio = audioBuffer.toString("base64");
		//console.log("base64Audio");
		//console.log(base64Audio);

		// const audioGPTanswer: MessageMedia = {
		// 	mimetype: "audio/opus",
		// 	/** Base64-encoded data of the file */
		// 	data: base64Audio
		// };

		//console.log("audioGPTanswer");
		//console.log(audioGPTanswer);
		//await message.reply(audioGPTanswer);

		//const audio = MessageMedia.fromFilePath("./src/audioGenarated/1.opus");
		//console.log("audio from file path");
		//console.log(audio);
		//await message.reply(audio);
		//message.reply(audioGPTanswer);
		//convertWavToOpus();
		// message.reply("./src/audioGenarated/Example.ogg");
		// message.reply("./src/audioGenarated/test.wav");

		//const input = new ffmpeg("./input.wav");
		// const input = new ffmpeg("./src/audioGenarated/test.wav");
		// input
		// 	.toFormat("ogg")
		// 	.save("./src/audioGenarated/output.ogg")
		// 	.on("end", () => {
		// 		console.log("Conversion complete!");
		// 	});
		//convertWavToOgg("./src/audioGenarated/test.wav", "./src/audioGenarated/output.ogg");
		// console.log(audio);
		//const audio = await MessageMedia.fromUrl("https://commons.wikimedia.org/wiki/File:Example.ogg");
		//console.log(audio);
		//message.reply(audio);
	} catch (error: any) {
		console.error("An error occured", error);
		//message.reply("An error occured, please contact the administrator. (" + error.message + ")");
	}
};

const handleDeleteConversation = async (message: Message) => {
	// Delete conversation
	delete conversations[message.from];

	// Reply
	message.reply("Conversation context was resetted!");
};

async function sendVoiceMessageReply(message: Message, gptTextResponse: string) {
	console.log(message);
	var logTAG = "[TTS]";
	var ttsRequest = async function (): Promise<Buffer | null> {
		return await speechTTSRequest(gptTextResponse);
	};

	switch (config.ttsMode) {
		case TTSMode.SpeechAPI:
			logTAG = "[SpeechAPI]";
			ttsRequest = async function (): Promise<Buffer | null> {
				return await speechTTSRequest(gptTextResponse);
			};
			break;

		// case TTSMode.AWSPolly:
		// 	logTAG = "[AWSPolly]";
		// 	ttsRequest = async function (): Promise<Buffer | null> {
		// 		return await awsTTSRequest(gptTextResponse);
		// 	};
		// 	break;

		default:
			logTAG = "[SpeechAPI]";
			ttsRequest = async function (): Promise<Buffer | null> {
				return await speechTTSRequest(gptTextResponse);
			};
			break;
	}

	// Get audio buffer
	cli.print(`${logTAG} Generating audio from GPT response "${gptTextResponse}"...`);
	const audioBuffer = await ttsRequest();

	// Check if audio buffer is valid
	if (audioBuffer == null || audioBuffer.length == 0) {
		message.reply(`${logTAG} couldn't generate audio, please contact the administrator.`);
		return;
	}

	cli.print(`${logTAG} Audio generated!`);

	// Get temp folder and file path
	const tempFolder = os.tmpdir();
	const tempFilePath = path.join(tempFolder, randomUUID() + ".opus");

	// Save buffer to temp file
	//console.log("tempFilePath", tempFilePath);
	fs.writeFileSync(tempFilePath, audioBuffer);

	// Send audio
	const messageMedia = new MessageMedia("audio/ogg; codecs=opus", audioBuffer.toString("base64"));

	message.reply(messageMedia, message.from);
	// Delete temp file
	fs.unlinkSync(tempFilePath);
	console.log("passa");
}

// const convertWavToOgg = async (inputPath, outputPath) => {
// 	var input = new ffmpeg('../audioGenarated/test.wav');
// 	try {
// 		// Load the input WAV file
// 		const input = ffmpeg.createInput(inputPath);

// 		// Convert the input file to OGG format
// 		const output = input.toFormat("ogg");

// 		// Save the output file
// 		await output.save(outputPath);

// 		console.log("Conversion complete!");
// 	} catch (error) {
// 		console.log(`Error converting file: ${error.message}`);
// 	}
// };

export { handleMessageGPT, handleDeleteConversation };

function convertWavToOpus() {
	console.log("entra em convertWavToOpus() ");
	const inputPath = "./src/audioGenarated/test.wav";
	const outputPath = "./src/audioGenarated/output.opus";

	Ffmpeg(inputPath)
		.audioCodec("libopus")
		.save(outputPath)
		.on("error", (err) => {
			console.log("An error occurred: " + err.message);
		})
		.on("end", () => {
			console.log("Conversion finished successfully");
		});
}
