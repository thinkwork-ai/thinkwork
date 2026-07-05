import { useRef, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { X } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Text, H2, Muted } from "@/components/ui/typography";

interface EnvironmentQrScannerProps {
  visible: boolean;
  onClose: () => void;
  /** Fired once per open with the raw scanned string. */
  onScanned: (data: string) => void;
  /** Fallback for simulators / denied permission. */
  onPasteInstead: () => void;
}

/**
 * Full-screen camera scanner for the environment-setup QR path. Scans the
 * web "Set up mobile" QR (thinkwork://deployment-profile link) or a plain
 * environment URL QR. Permission-denied and no-camera states fall back to
 * the paste-link flow.
 */
export function EnvironmentQrScanner({
  visible,
  onClose,
  onScanned,
  onPasteInstead,
}: EnvironmentQrScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const [requesting, setRequesting] = useState(false);

  const handleBarcode = ({ data }: { data: string }) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    onScanned(data);
  };

  const handleRequest = async () => {
    setRequesting(true);
    try {
      await requestPermission();
    } finally {
      setRequesting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => {
        scannedRef.current = false;
      }}
    >
      <View className="flex-1 bg-black">
        {permission?.granted ? (
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={handleBarcode}
          />
        ) : (
          <View className="flex-1 items-center justify-center gap-4 p-8">
            <H2 className="text-center text-white">Scan setup QR</H2>
            <Muted className="text-center">
              ThinkWork needs camera access to scan the QR code from your web
              app&apos;s &quot;Set up mobile&quot; card.
            </Muted>
            <Button onPress={() => void handleRequest()} loading={requesting}>
              Allow camera access
            </Button>
            <Pressable className="py-2" onPress={onPasteInstead}>
              <Text size="sm" className="text-center text-sky-500">
                Paste the setup link instead
              </Text>
            </Pressable>
          </View>
        )}

        {permission?.granted && (
          <View className="absolute inset-x-0 bottom-12 items-center gap-3">
            <Muted className="text-center text-white">
              Point the camera at the QR on your web app&apos;s Set up mobile
              card.
            </Muted>
            <Pressable className="py-2" onPress={onPasteInstead}>
              <Text size="sm" className="text-center text-sky-500">
                Paste the setup link instead
              </Text>
            </Pressable>
          </View>
        )}

        <Pressable
          className="absolute right-5 top-14 rounded-full bg-neutral-900/80 p-2"
          onPress={onClose}
          accessibilityLabel="Close scanner"
        >
          <X size={22} color="#ffffff" />
        </Pressable>
      </View>
    </Modal>
  );
}
