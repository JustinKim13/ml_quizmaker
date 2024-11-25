import React, { useState } from "react";
import FileUpload from "./components/FileUpload";
import Lobby from "./components/Lobby";
import GamePlay from "./components/GamePlay";

function App() {
    const [gameData, setGameData] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [isPlaying, setIsPlaying] = useState(false);

    const startGame = async () => {
        try {
            // Wait until the questions are ready (use polling)
            let questionsReady = false;
            while (!questionsReady) {
                const statusResponse = await fetch("http://localhost:5000/api/status");
                const statusData = await statusResponse.json();
                if (statusData.questionsGenerated) {
                    questionsReady = true;
                } else {
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                }
            }

            // Once questions are ready, fetch them
            const response = await fetch("http://localhost:5000/api/questions");
            const data = await response.json();
            
            if (data.questions) {
                setQuestions(data.questions);
                setIsPlaying(true);
            } else {
                throw new Error("No questions found in response");
            }
        } catch (error) {
            console.error("Error starting the game:", error);
            alert("An error occurred while starting the game. Please try again.");
        }
    };

    if (!gameData) {
        return <FileUpload setGameData={setGameData} />;
    }

    if (!isPlaying) {
        return <Lobby gameData={gameData} startGame={startGame} />;
    }

    return <GamePlay 
        questions={questions} 
        onFinish={() => setIsPlaying(false)} 
    />;
}

export default App;
