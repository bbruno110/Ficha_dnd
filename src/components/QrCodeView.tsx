import React, { useMemo } from 'react';
import { View } from 'react-native';

import { qrCodeStyles as styles } from '@/styles/globalStyles';

const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

type Props = {
  value: string;
  size?: number;
};

export default function QrCodeView({ value, size = 260 }: Props) {
  const matrix = useMemo(() => buildQrMatrix(value), [value]);
  const cellSize = size / matrix.length;

  return (
    <View style={[styles.qrBox, { width: size, height: size }]}>
      {matrix.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.qrRow}>
          {row.map((isDark, columnIndex) => (
            <View
              key={`${rowIndex}-${columnIndex}`}
              style={[
                styles.qrCell,
                { width: cellSize, height: cellSize },
                isDark && styles.qrCellDark,
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function buildQrMatrix(value: string) {
  const qr = new QRCode(0, QRErrorCorrectLevel.M);
  qr.addData(value);
  qr.make();

  const count = qr.getModuleCount();
  const quietZone = 2;
  const matrix: boolean[][] = [];

  for (let row = -quietZone; row < count + quietZone; row++) {
    const line: boolean[] = [];
    for (let column = -quietZone; column < count + quietZone; column++) {
      line.push(row >= 0 && column >= 0 && row < count && column < count ? qr.isDark(row, column) : false);
    }
    matrix.push(line);
  }

  return matrix;
}
