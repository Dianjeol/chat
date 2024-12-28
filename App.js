giimport React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet, Modal, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

const RootApp = () => {
  const [recording, setRecording] = useState();
  const [isProcessing, setIsProcessing] = useState(false);
  const [conversation, setConversation] = useState([]);
  const [error, setError] = useState(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [lemonFoxApiKey, setLemonFoxApiKey] = useState('');
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');

  useEffect(() => {
    const loadData = async () => {
      try {
        const savedConversation = await AsyncStorage.getItem('conversation');
        if (savedConversation) {
          setConversation(JSON.parse(savedConversation));
        }
        const savedLemonFoxApiKey = await AsyncStorage.getItem('lemonFoxApiKey');
        if (savedLemonFoxApiKey) {
          setLemonFoxApiKey(savedLemonFoxApiKey);
        }
        const savedOpenRouterApiKey = await AsyncStorage.getItem('openRouterApiKey');
        if (savedOpenRouterApiKey) {
          setOpenRouterApiKey(savedOpenRouterApiKey);
        }
      } catch (err) {
        console.error('Failed to load data:', err);
      }
    };
    loadData();
  }, []);

  async function startRecording() {
    try {
      console.log('Requesting permissions..');
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      console.log('Starting recording..');
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(recording);
      console.log('Recording started');
    } catch (err) {
      console.error('Failed to start recording', err);
      setError('Failed to start recording');
    }
  }

  async function stopRecording() {
    console.log('Stopping recording..');
    setRecording(undefined);
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      console.log('Recording stopped and stored at', uri);
      return uri;
    } catch (error) {
      console.error('Failed to stop recording:', error);
      setError('Failed to stop recording');
      return null;
    }
  }

  const handleRecording = async () => {
    if (!lemonFoxApiKey || !openRouterApiKey) {
      Alert.alert("API-Schlüssel fehlen", "Bitte gib die API-Schlüssel in den Einstellungen ein.");
      setShowSettings(true);
      return;
    }

    if (recording) {
      setIsProcessing(true);
      try {
        const audioUri = await stopRecording();
        if (!audioUri) return;

        const base64Audio = await FileSystem.readAsStringAsync(audioUri, { encoding: 'base64' });

        // Transcribe with LemonFox API
        const formData = new FormData();
        formData.append('file', {
          uri: `data:audio/wav;base64,${base64Audio}`,
          type: 'audio/wav',
          name: 'audio.wav'
        });
        formData.append('language', 'german');
        formData.append('response_format', 'json');

        const transcriptionResponse = await axios.post('https://api.lemonfox.ai/v1/audio/transcriptions', formData, {
          headers: {
            'Authorization': `Bearer ${lemonFoxApiKey}`,
            'Content-Type': 'multipart/form-data'
          }
        });

        if (!transcriptionResponse.data || !transcriptionResponse.data.text) {
          throw new Error('Invalid response from LemonFox API');
        }

        const transcription = transcriptionResponse.data.text;
        const conversationHistory = conversation.map(msg => `${msg.speaker}: ${msg.message}`).join('\n');
        const llmPrompt = `Konversationsverlauf:\n${conversationHistory}\n\nNeue Nachricht: ${transcription}`;
        const url = "https://openrouter.ai/api/v1/chat/completions";

        const response = await axios.post(url, {
          model: "deepseek/deepseek-chat",
          messages: [{ role: "user", content: llmPrompt }],
        }, {
          headers: {
            "Authorization": `Bearer ${openRouterApiKey}`,
            "Content-Type": "application/json",
          }
        });

        if (!response.data || !response.data.choices || !response.data.choices[0]) {
          throw new Error('Invalid response from DeepSeek API');
        }

        const llmResponse = response.data.choices[0].message.content;

        const newConversation = [
          ...conversation,
          { speaker: 'You', message: transcription },
          { speaker: 'LLM', message: llmResponse }
        ];
        setConversation(newConversation);
        await AsyncStorage.setItem('conversation', JSON.stringify(newConversation));

        if (ttsEnabled) {
          const cleanText = llmResponse.replace(/[\u{1F300}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F191}-\u{1F251}]|[\u{1F004}]|[\u{1F0CF}]/gu, '');
          Speech.speak(cleanText, { rate: 1.8 });
        }
      } catch (err) {
        console.error('Error during processing:', err);
        setError('An error occurred. Please try again.');
      } finally {
        setIsProcessing(false);
      }
    } else {
      startRecording();
    }
  };

  const saveApiKeys = async () => {
    try {
      await AsyncStorage.setItem('lemonFoxApiKey', lemonFoxApiKey);
      await AsyncStorage.setItem('openRouterApiKey', openRouterApiKey);
      setShowSettings(false);
      Alert.alert("Gespeichert", "Die API-Schlüssel wurden gespeichert.");
    } catch (err) {
      console.error('Failed to save API keys:', err);
      Alert.alert("Fehler", "Die API-Schlüssel konnten nicht gespeichert werden.");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.settingsButton}>
          <Ionicons name="settings-sharp" size={24} color="gray" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.conversationContainer} contentContainerStyle={{ paddingBottom: 20 }}>
        {conversation.map((msg, index) => (
          <View key={index} style={msg.speaker === 'You' ? styles.userMessage : styles.llmMessage}>
            <Text style={styles.speaker}>{msg.speaker}</Text>
            <Text style={styles.messageText}>{msg.message}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.controls}>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <TouchableOpacity
          style={[styles.ttsButton, ttsEnabled && styles.ttsEnabled]}
          onPress={() => setTtsEnabled(!ttsEnabled)}
        >
          <Ionicons name={ttsEnabled ? "volume-high" : "volume-mute"} size={24} color="white" />
        </TouchableOpacity>
        {isProcessing ? (
          <ActivityIndicator size="large" color="#0000ff" />
        ) : (
          <TouchableOpacity
            style={[styles.recordButton, recording && styles.recording]}
            onPress={handleRecording}
          >
            <Ionicons name={recording ? 'stop' : 'mic'} size={40} color="white" />
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={showSettings} animationType="slide" transparent={true}>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>API-Schlüssel eingeben</Text>
            <TextInput
              style={styles.input}
              placeholder="LemonFox API Key"
              value={lemonFoxApiKey}
              onChangeText={setLemonFoxApiKey}
              placeholderTextColor="#999"
            />
            <TextInput
              style={styles.input}
              placeholder="OpenRouter API Key"
              value={openRouterApiKey}
              onChangeText={setOpenRouterApiKey}
              placeholderTextColor="#999"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.saveButton} onPress={saveApiKeys}>
                <Text style={styles.saveButtonText}>Speichern</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setShowSettings(false)}>
                <Text style={styles.cancelButtonText}>Abbrechen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    paddingTop: 50,
    paddingLeft: 20,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginBottom: 10,
  },
  settingsButton: {
    padding: 5,
  },
  conversationContainer: {
    flex: 1,
    padding: 20,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#007AFF',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    maxWidth: '80%',
  },
  llmMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#e0e0e0',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    maxWidth: '80%',
  },
  speaker: {
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#333',
  },
  messageText: {
    color: '#333',
  },
  controls: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#ddd',
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recording: {
    backgroundColor: '#ff3b30',
  },
  errorText: {
    color: '#ff3b30',
    marginBottom: 10,
  },
  ttsButton: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#8e8e93',
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.8,
  },
  ttsEnabled: {
    backgroundColor: '#34c759',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 10,
    width: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    padding: 10,
    marginBottom: 10,
    color: '#000'
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    padding: 10,
    borderRadius: 5,
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  cancelButton: {
    backgroundColor: '#ccc',
    padding: 10,
    borderRadius: 5,
  },
  cancelButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});

export default RootApp;