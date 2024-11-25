import React, { useState } from "react";
import FileUpload from "./components/FileUpload";
import Lobby from "./components/Lobby";
import GamePlay from "./components/GamePlay";

function App() {
  // state variables (piece of data that a component manages and remembers between renders)
    const [gameData, setGameData] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [metadata, setMetadata] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);

    // function to start the game
    const startGame = async () => {
        try {
            // Wait until the questions are ready (use polling)
            let questionsReady = false; // set true when our files have finished running
            while (!questionsReady) {
                const statusResponse = await fetch("/api/status"); // check if questions are ready
                const statusData = await statusResponse.json(); // parse the response (true or false)
                if (statusData.questionsGenerated) { // if questions are ready
                    questionsReady = true; // set true
                } else {
                    await new Promise((resolve) => setTimeout(resolve, 2000)); // Poll every 2 seconds
                }
            }

            // Once questions are ready, fetch them
            const response = await fetch("/api/questions"); // fetch the questions
            const data = await response.json(); // parse the response
            
            // Handle the new JSON structure
            if (data.metadata && data.questions) {
                setMetadata(data.metadata);
                setQuestions(data.questions);
                setIsPlaying(true);
            } else if (data.metadata?.error) {
                // Handle case where question generation failed
                throw new Error(data.metadata.error);
            } else {
                throw new Error("Invalid question data format");
            }
        } catch (error) {
            console.error("Error starting the game:", error);
            alert("An error occurred while starting the game. Please try again.");
        }
    };

    if (!gameData) {
        // Step 1: Upload files and transition to the Lobby
        return <FileUpload setGameData={setGameData} />;
    }

    if (!isPlaying) {
        // Step 2: Show Lobby, allow user to start the game once questions are ready
        return <Lobby gameData={gameData} startGame={startGame} />;
    }

    // Step 3: Show gameplay once questions are ready and the game has started
    return <GamePlay 
        questions={questions} 
        metadata={metadata}
        onFinish={() => setIsPlaying(false)} 
    />;
}

export default App;
