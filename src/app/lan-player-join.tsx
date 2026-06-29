import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLanSession } from '../contexts/LanSessionContext';
import { buildSessionShareCode, formatManualSessionCode, parseSessionCode } from '../network/lanProtocol';
import { LAN_DEFAULT_PORT } from '../types/lan';

function normalizeIpInput(value: string) {
  return value.replace(/[^0-9.]/g, '').slice(0, 15);
}

function isValidIpv4(value: string) {
  const parts = value.trim().split('.');
  return parts.length === 4 && parts.every(part => {
    const number = Number(part);
    return Number.isInteger(number) && number >= 0 && number <= 255 && part === String(number);
  });
}

export default function LanPlayerJoinScreen() {
  const router = useRouter();
  const { activeSession, joinPlayerSession } = useLanSession();
  const [joinCode, setJoinCode] = useState('');
  const [hostIpOverride, setHostIpOverride] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [scannerVisible, setScannerVisible] = useState(false);
  const [joining, setJoining] = useState(false);
  const scanLockRef = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const returnToLanSession = () => {
    const routerWithDismiss = router as any;
    if (typeof routerWithDismiss.dismissTo === 'function') {
      routerWithDismiss.dismissTo('/lan-session');
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/lan-session');
  };

  const openScanner = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Camera bloqueada', 'Permita o acesso a camera para escanear QR Codes.');
        return;
      }
    }

    setScannerVisible(true);
  };

  const handleJoin = async (codeOverride?: string) => {
    if (joining) return;

    try {
      setJoining(true);
      const rawCode = codeOverride || joinCode;
      const ipOverride = hostIpOverride.trim();
      let finalCode = rawCode;

      if (!codeOverride && ipOverride) {
        if (!isValidIpv4(ipOverride)) {
          throw new Error('IP do mestre invalido. Use o formato que aparece na tela do mestre, por exemplo 192.168.1.34.');
        }

        const parsedCode = parseSessionCode(rawCode);
        if (!parsedCode) {
          throw new Error('Codigo de sessao invalido. Digite o codigo da mesa e, se quiser, o IP que aparece no aparelho do mestre.');
        }

        finalCode = parsedCode.hostIp
          ? rawCode
          : buildSessionShareCode(parsedCode.sessionId, ipOverride, parsedCode.port || LAN_DEFAULT_PORT, [ipOverride]);
      }

      await joinPlayerSession({
        code: finalCode,
        playerName,
        linkedCharacterId: null,
      });
      returnToLanSession();
    } catch (error) {
      Alert.alert('Erro LAN', error instanceof Error ? error.message : 'Não foi possível entrar na sessão.');
    } finally {
      setJoining(false);
      scanLockRef.current = false;
    }
  };

  return (
    <LinearGradient colors={['#102b56', '#02112b']} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>ENTRAR NA LAN</Text>
        <View style={{ width: 28 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.heroBox}>
            <Ionicons name="log-in-outline" size={32} color="#00bfff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>Entrada do Jogador</Text>
              <Text style={styles.heroSub}>Informe seu nome e o código/QR Code. Depois da conexão, você vai vincular uma ficha existente ou criar uma nova conforme a regra do mestre.</Text>
            </View>
          </View>

          {activeSession && (
            <View style={styles.warningBox}>
              <Ionicons name="warning-outline" size={20} color="#ffd166" />
              <Text style={styles.warningText}>Este aparelho já possui uma sessão selecionada. Ao entrar em outra, a anterior será mantida como mesa salva para retomada.</Text>
            </View>
          )}

          <View style={styles.formPanel}>
            <View style={styles.formGroup}>
              <Text style={styles.label}>SEU NOME NA MESA</Text>
              <TextInput
                style={styles.input}
                value={playerName}
                onChangeText={setPlayerName}
                placeholder="Ex: Bruno"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>CODIGO DA SESSAO</Text>
              <View style={styles.codeInputRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={joinCode}
                  onChangeText={text => setJoinCode(formatManualSessionCode(text))}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="XXXX-XXXX-XXXX"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                />
                <TouchableOpacity style={styles.scanButton} onPress={openScanner}>
                  <Ionicons name="qr-code-outline" size={24} color="#02112b" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>IP DO MESTRE (OPCIONAL)</Text>
              <TextInput
                style={styles.input}
                value={hostIpOverride}
                onChangeText={text => setHostIpOverride(normalizeIpInput(text))}
                keyboardType="decimal-pad"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Ex: 192.168.1.34"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
              <Text style={styles.fieldHint}>Use se o QR/codigo curto nao encontrar a mesa. O IP aparece abaixo do QR no aparelho do mestre.</Text>
            </View>

            <TouchableOpacity style={[styles.primaryButton, joining && styles.disabledButton]} disabled={joining} onPress={() => handleJoin()}>
              <Ionicons name="people-outline" size={20} color="#02112b" />
              <Text style={styles.primaryButtonText}>{joining ? 'ENTRANDO...' : 'ENTRAR COMO JOGADOR'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={scannerVisible} animationType="slide">
        <View style={styles.scannerContainer}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (scanLockRef.current) return;
              scanLockRef.current = true;
              setJoinCode(data);
              setScannerVisible(false);
              void handleJoin(data);
            }}
          />
          <View style={styles.scannerTop}>
            <TouchableOpacity style={styles.scannerClose} onPress={() => setScannerVisible(false)}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={styles.scannerFrame} />
          <Text style={styles.scannerText}>Aponte para o QR Code do mestre</Text>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    paddingTop: 50,
    paddingBottom: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  topBarTitle: { color: '#00bfff', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  scrollContent: { padding: 20, paddingBottom: 60 },
  heroBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(0,191,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.25)',
    marginBottom: 14,
  },
  heroTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  heroSub: { color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 18, marginTop: 4 },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,209,102,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,209,102,0.25)',
    marginBottom: 14,
  },
  warningText: { color: '#ffd166', flex: 1, fontSize: 12, lineHeight: 18 },
  formPanel: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16 },
  formGroup: { marginBottom: 16 },
  label: { fontSize: 11, fontWeight: 'bold', color: '#00bfff', marginBottom: 8, letterSpacing: 1 },
  fieldHint: { color: 'rgba(255,255,255,0.45)', fontSize: 11, lineHeight: 16, marginTop: 8 },
  input: {
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
  },
  codeInputRow: { flexDirection: 'row', gap: 10 },
  scanButton: {
    width: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00bfff',
  },
  primaryButton: {
    backgroundColor: '#00fa9a',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  primaryButtonText: { color: '#02112b', fontWeight: 'bold', fontSize: 15, letterSpacing: 1 },
  disabledButton: { opacity: 0.45 },
  scannerContainer: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  scannerTop: { position: 'absolute', top: 48, left: 20, right: 20, zIndex: 2 },
  scannerClose: {
    alignSelf: 'flex-end',
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  scannerFrame: {
    width: 250,
    height: 250,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: '#00fa9a',
    backgroundColor: 'transparent',
  },
  scannerText: {
    position: 'absolute',
    bottom: 90,
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
});
