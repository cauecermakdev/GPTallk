import { Message } from "whatsapp-web.js";
import { startsWithIgnoreCase } from "../utils";

// Config & Constants
import config from "../config";

// CLI
import * as cli from "../cli/ui";

// ChatGPT & DALLE
import { handleMessageGPT, handleDeleteConversation } from "../handlers/gpt";
import { handleMessageDALLE } from "../handlers/dalle";
import { handleMessageAIConfig } from "../handlers/ai-config";

// Speech API & Whisper
import { TranscriptionMode } from "../types/transcription-mode";
import { transcribeRequest } from "../providers/speech";
import { transcribeAudioLocal } from "../providers/whisper-local";
import { transcribeWhisperApi } from "../providers/whisper-api";
import { transcribeOpenAI } from "../providers/openai";

// For deciding to ignore old messages
import { botReadyTimestamp } from "../index";
import { OpenAIApiAxiosParamCreator } from "openai";
import axios from "axios";

// Handles message
async function handleIncomingMessage(message: Message) {
	console.log("entra handling incoming message");
	let messageString = message.body;

	//GETTING ANKI-WORDS FROM DB TO REFORMULATE ANSWER
	//put this words on answer
	const apiBackGpt = process.env.BACK_GPTTALK_API_BASE_URL;
	const listAnkiWordsObjects = await axios.get(`${apiBackGpt}/words`);
	const listAnkiWords = listAnkiWordsObjects.data.map((e) => e.word);
	const stringWords = "please answer using this words: " + listAnkiWords.join(", ");
	console.log(stringWords);
	//console.log(listAnkiWordsObjects.data.map((e) => e.word));

	async function qualityWord(word) {
		//preciso fazer uma rota no back que retorna true se a palavra está no banco e false senao
		const wordExist = await axios.get(`${apiBackGpt}/words/:${word}`);
		console.log("\nentra em quality word\n");
		//se a palavra está no banco e o usuario quer saber ela
		//isso significa que nao lembrou da palavra, o quality é baixo = 0
		//se nao esta no banco o quality tambem é baixo = 0

		//se a palavra esta no banco mas o usuario não escreveu
		//o quality é alto, 5

		if (wordExist) {
			console.log(`\na palavra ${word} ja estava no banco, logo sua qualidade foi 4\n`);
			return 5;
		} else {
			console.log(`a palavra ${word} não estava no banco, logo sua qualidade foi 2`);
			return 2;
		}
	}

	//post words que eu nao se,se a usuario insere /unknow
	if (messageString.includes("/meaning")) {
		//ARRUMANDO CABECALHO DA REQUISICAO POST
		console.log("meaning entrou");
		const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
		const header = {
			headers: {
				Authorization: `Bearer ${token}`
			}
		};

		//AUMENTANDO SCORE DAS PALAVRAS NAO LEMBRADAS
		const unknownWordsString = messageString.replace("/meaning", "");
		const meaningWordsArray = unknownWordsString.split(" ");

		meaningWordsArray.forEach(async (word) => {
			console.log(word);
			try {
				if (word === " " || word === "") return;
				const response = await axios.post(
					`${process.env.BACK_GPTTALK_API_BASE_URL}/words`,
					{ word: word, quality: await qualityWord(word) },
					header
				);
				console.log(response.data);
				//message.reply(`The word *${e}*.`);
				await handleMessageGPT(message, `Show me the meaning of word ${word} in max 20 words.`);
			} catch (err) {
				console.log(err.message);
				//message.reply(`not inserted, contact adm`);
			}
		});

		//ABAIXAR SCORE DOS USUARIOS QUE LEMBRARAM UMA PALAVRA(QUALITY = 2)
		//*****colocar fora do /meaning pois se o usuario nao coloca nada abaixa o score******

		//post das palavras que tem na lista, que tem na resposta, mas o usuario nao teve duvida
		//const noDoubtWordShowedOnResponse =

		const noDoubtWordShowedOnResponse = listAnkiWords?.filter((palavra) => !meaningWordsArray?.includes(palavra));
		message.reply(`noDoubtWordShowedOnResponse ${noDoubtWordShowedOnResponse}`);
		const noDoubtWordsRemembered = noDoubtWordShowedOnResponse?.filter((w) => messageString?.includes(w));
		message.reply(`noDoubtWordsRemembered ${noDoubtWordsRemembered}`);

		//post dos quality das palavras que apareceram na resposta e o usuario lembrou(nao colocou na lista de /meaning)
		noDoubtWordsRemembered?.forEach(async (word) => {
			console.log(word);
			try {
				if (word === " " || word === "") return;
				const response = await axios.post(`${process.env.BACK_GPTTALK_API_BASE_URL}/words`, { word: word, quality: 2 }, header);
				console.log(response.data);
				//message.reply(`The word *${e}*.`);
				//await handleMessageGPT(message, `Show me the meaning of word ${word} in max 20 words.`);
				message.reply(`You remembered this words:${noDoubtWordsRemembered}`);
			} catch (err) {
				console.log(err.message);
				//message.reply(`not inserted, contact adm`);
			}
		});

		return;
	}

	// Prevent handling old messages
	if (message.timestamp != null) {
		const messageTimestamp = new Date(message.timestamp * 1000);

		// If startTimestamp is null, the bot is not ready yet
		if (botReadyTimestamp == null) {
			cli.print("Ignoring message because bot is not ready yet: " + messageString);
			return;
		}

		// Ignore messages that are sent before the bot is started
		if (messageTimestamp < botReadyTimestamp) {
			cli.print("Ignoring old message: " + messageString);
			return;
		}
	}

	// Transcribe audio
	if (message.hasMedia) {
		console.log("entra trancribe audio");
		const media = await message.downloadMedia();
		console.log(media);

		// Ignore non-audio media
		if (!media || !media.mimetype.startsWith("audio/")) return;

		// Check if transcription is enabled (Default: false)
		if (!config.transcriptionEnabled) {
			cli.print("[Transcription] Received voice messsage but voice transcription is disabled.");
			return;
		}

		// Convert media to base64 string
		const mediaBuffer = Buffer.from(media.data, "base64");

		// Transcribe locally or with Speech API
		cli.print(`[Transcription] Transcribing audio with "${config.transcriptionMode}" mode...`);

		let res;
		switch (config.transcriptionMode) {
			case TranscriptionMode.Local:
				res = await transcribeAudioLocal(mediaBuffer);
				break;
			case TranscriptionMode.OpenAI:
				res = await transcribeOpenAI(mediaBuffer);
				break;
			case TranscriptionMode.WhisperAPI:
				res = await transcribeWhisperApi(new Blob([mediaBuffer]));
				break;
			case TranscriptionMode.SpeechAPI:
				res = await transcribeRequest(new Blob([mediaBuffer]));
				break;
			default:
				cli.print(`[Transcription] Unsupported transcription mode: ${config.transcriptionMode}`);
		}
		const { text: transcribedText, language: transcribedLanguage } = res;

		// Check transcription is null (error)
		if (transcribedText == null) {
			message.reply("I couldn't understand what you said.");
			return;
		}

		// Check transcription is empty (silent voice message)
		if (transcribedText.length == 0) {
			message.reply("I couldn't understand what you said.");
			return;
		}

		// Log transcription
		cli.print(`[Transcription] Transcription response: ${transcribedText} (language: ${transcribedLanguage})`);

		// Reply with transcription
		const reply = `You said: ${transcribedText}${transcribedLanguage ? " (language: " + transcribedLanguage + ")" : ""}`;
		if (message.fromMe) message.reply(reply);
		//say.speak(reply, "Alex", 0.5);

		// Handle message GPT
		if (message.fromMe) await handleMessageGPT(message, transcribedText + stringWords);
		//correct my english
		// GPT = putTheWordsThatDontknow(transcribedText);

		//const newText = `give me a short answer with in max 20 words to this question putting this words in answer if it makes sense "good" "throught" "friday", my question is ${transcribedText} `;
		//await handleMessageGPT(message, newText);

		if (message.fromMe) await handleMessageGPT(message, `correct this sentence in english please ${transcribedText} + ${stringWords}`);
		//await handleMessageGPT(message, ` ${transcribedText} + ${stringWords}`);

		return;
	}

	// Clear conversation context (!clear)
	if (startsWithIgnoreCase(messageString, config.resetPrefix)) {
		await handleDeleteConversation(message);
		return;
	}

	// AiConfig (!config <args>)
	if (startsWithIgnoreCase(messageString, config.aiConfigPrefix)) {
		const prompt = messageString.substring(config.aiConfigPrefix.length + 1);
		await handleMessageAIConfig(message, prompt);
		return;
	}

	// GPT (only <prompt>)

	const selfNotedMessage = message.fromMe && message.hasQuotedMsg === false && message.from === message.to;

	// GPT (!gpt <prompt>)
	if (startsWithIgnoreCase(messageString, config.gptPrefix)) {
		const prompt = messageString.substring(config.gptPrefix.length + 1);
		await handleMessageGPT(message, prompt + stringWords);
		return;
	}

	// DALLE (!dalle <prompt>)
	if (startsWithIgnoreCase(messageString, config.dallePrefix)) {
		const prompt = messageString.substring(config.dallePrefix.length + 1);
		await handleMessageDALLE(message, prompt);
		return;
	}

	if (!config.prefixEnabled || (config.prefixSkippedForMe && selfNotedMessage)) {
		await handleMessageGPT(message, messageString + stringWords);
		return;
	}
}

export { handleIncomingMessage };

// automatically pick platform
//import say from "say";

// or, override the platform
//const Say = say.Say
//const say = new Say('darwin' || 'win32' || 'linux');

// Use default system voice and speed
// say.speak("Hello!");

// Stop the text currently being spoken
// say.stop();

// More complex example (with an OS X voice) and slow speed
// say.speak("What's up, dog?", "Alex", 0.5);

// Fire a callback once the text has completed being spoken
// say.speak("What's up, dog?", "Good News", 1.0, (err) => {
// 	if (err) {
// 		return console.error(err);
// 	}

// 	console.log("Text has been spoken.");
// });

// // Export spoken audio to a WAV file
// say.export("I'm sorry, Dave.", "Alex", 0.75, "../audioGenareted/hal.wav", (err) => {
// 	if (err) {
// 		return console.error(err);
// 	}

// 	console.log("Text has been saved to hal.wav.");
// });
