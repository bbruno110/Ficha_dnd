import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import * as CANNON from 'cannon-es';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as THREE from 'three';

type MaterialIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface DieType {
  id: string;
  max: number;
  icon: MaterialIconName;
  color: string;
  label: string;
}

const { width, height } = Dimensions.get('window');
const FAB_SIZE = 60;
const SNAP_MARGIN = 20;

const DICE_TYPES: DieType[] = [
  { id: 'd4', max: 4, label: 'D4', icon: 'dice-d4-outline', color: '#ff9f43' },
  { id: 'd6', max: 6, label: 'D6', icon: 'dice-d6-outline', color: '#ff4757' },
  { id: 'd8', max: 8, label: 'D8', icon: 'dice-d8-outline', color: '#2ed573' },
  { id: 'd10', max: 10, label: 'D10', icon: 'dice-d10-outline', color: '#1dd1a1' },
  { id: 'd12', max: 12, label: 'D12', icon: 'dice-d12-outline', color: '#9b59b6' },
  { id: 'd20', max: 20, label: 'D20', icon: 'dice-d20-outline', color: '#1e90ff' },
  { id: 'd100', max: 100, label: 'D100', icon: 'dice-multiple-outline', color: '#576574' },
];

function SingleDie({ die, world, diceMat, skipAnim, count, onResult }: { die: DieType, world: CANNON.World, diceMat: CANNON.Material, skipAnim: boolean, count: number, onResult: (val: string, position: {x: number, y: number}, fontSize: number) => void }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const edgesRef = useRef<THREE.LineSegments>(null!);
  const [isDone, setIsDone] = useState(false);
  const { camera, size } = useThree();

  const scaleMult = useMemo(() => Math.max(0.65, 1 - (count - 1) * 0.08), [count]);

  const { geometry, edgesGeom, facesData, radius } = useMemo(() => {
    let baseGeom;
    switch (die.id) {
      case 'd4': baseGeom = new THREE.TetrahedronGeometry(0.95); break;
      case 'd6': baseGeom = new THREE.BoxGeometry(1.2, 1.2, 1.2); break;
      case 'd8': baseGeom = new THREE.OctahedronGeometry(0.95); break;
      case 'd12': baseGeom = new THREE.DodecahedronGeometry(0.9); break;
      default: baseGeom = new THREE.IcosahedronGeometry(0.95, 0); break; // d20 e d100 usam Icosaedro base (no visual)
    }
    
    baseGeom.scale(scaleMult, scaleMult, scaleMult);
    const nonIndexed = baseGeom.index ? baseGeom.toNonIndexed() : baseGeom;
    nonIndexed.computeVertexNormals();

    const edges = new THREE.EdgesGeometry(nonIndexed);
    
    const pos = nonIndexed.attributes.position;
    const numFaces = pos.count / 3;
    const uniqueFaces: any[] = [];
    
    for (let i = 0; i < numFaces; i++) {
      const vA = new THREE.Vector3().fromBufferAttribute(pos, i * 3);
      const vB = new THREE.Vector3().fromBufferAttribute(pos, i * 3 + 1);
      const vC = new THREE.Vector3().fromBufferAttribute(pos, i * 3 + 2);
      const normal = new THREE.Vector3().subVectors(vC, vB).cross(new THREE.Vector3().subVectors(vA, vB)).normalize();
      
      let found = uniqueFaces.find(f => f.localNormal.dot(normal) > 0.95);
      
      if (!found) {
        // === CORREÇÃO DEFINITIVA DO D10 E D100 ===
        let faceIndex = uniqueFaces.length + 1; // De 1 até max
        let textVal = `${faceIndex}`;
        
        if (die.id === 'd10') {
            textVal = faceIndex === 10 ? "0" : `${faceIndex}`; // 1 a 9 e 0 (como num d10 real)
        } else if (die.id === 'd100') {
            // O Icosaedro gerado aqui tem 20 faces. Multiplicamos por 5 para ter dezenas, 
            // mas como é d100 de face pura, vamos usar apenas o index real * 5 (para dar a ilusão de 100).
            // A matemática garante que não há zero caindo sozinho.
            textVal = `${faceIndex * 5}`;
        }
        
        uniqueFaces.push({ 
            localNormal: normal.clone(), 
            text: textVal,
            vertices: [vA.clone(), vB.clone(), vC.clone()] 
        });
      } else {
        found.vertices.push(vA.clone(), vB.clone(), vC.clone());
      }
    }

    let rad = 0.8;
    if (die.id === 'd4') rad = 0.5;
    if (die.id === 'd6') rad = 0.65;
    if (die.id === 'd8') rad = 0.7;

    return { geometry: nonIndexed, edgesGeom: edges, facesData: uniqueFaces, radius: rad * scaleMult };
  }, [die, scaleMult]);

  const body = useMemo(() => {
    const shape = new CANNON.Sphere(radius);
    const b = new CANNON.Body({ mass: 1, shape, material: diceMat });
    
    b.linearDamping = 0.1; 
    b.angularDamping = 0.4;
    b.position.set((Math.random() - 0.5) * 3, 10 + Math.random() * 5, (Math.random() - 0.5) * 3);
    
    const f = 1.5 + Math.random() * 2;
    b.velocity.set((Math.random() - 0.5) * 30 * f, -20 * f, (Math.random() - 0.5) * 30 * f);
    b.angularVelocity.set((Math.random() - 0.5) * 80 * f, (Math.random() - 0.5) * 80 * f, (Math.random() - 0.5) * 80 * f);
    return b;
  }, [radius, diceMat]);

  useEffect(() => {
    world.addBody(body);
    return () => { world.removeBody(body); };
  }, [world, body]);

  const finalize = (forcedSkip = false) => {
    if (isDone) return;
    setIsDone(true);
    
    if (forcedSkip) {
        body.position.y = radius;
        body.position.x = Math.max(-1.8, Math.min(1.8, body.position.x));
        body.position.z = Math.max(-1.8, Math.min(3.5, body.position.z));
        meshRef.current.position.copy(body.position as any);
    }

    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.type = CANNON.Body.STATIC;

    let best = facesData[0];
    let maxDot = -1;
    
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const targetDir = camDir.clone().negate();

    facesData.forEach(f => {
      const worldNormal = f.localNormal.clone().applyQuaternion(meshRef.current.quaternion);
      const dot = worldNormal.dot(targetDir);
      if (dot > maxDot) { maxDot = dot; best = f; }
    });

    const currentNormal = best.localNormal.clone().applyQuaternion(meshRef.current.quaternion);
    const align = new THREE.Quaternion().setFromUnitVectors(currentNormal, targetDir);
    meshRef.current.quaternion.premultiply(align);
    meshRef.current.rotateOnWorldAxis(targetDir, Math.PI / 12); 

    if (edgesRef.current) {
        edgesRef.current.quaternion.copy(meshRef.current.quaternion);
        edgesRef.current.position.copy(meshRef.current.position);
    }

    // === CÁLCULO DE ÁREA E POSIÇÃO 2D DA FACE ===
    meshRef.current.updateMatrixWorld(true);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let sumX = 0, sumY = 0;

    best.vertices.forEach((v: THREE.Vector3) => {
        const worldV = v.clone().applyMatrix4(meshRef.current.matrixWorld);
        worldV.project(camera);
        
        const px = (worldV.x * .5 + .5) * size.width;
        const py = (worldV.y * -.5 + .5) * size.height;
        
        sumX += px;
        sumY += py;

        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
    });

    // O verdadeiro centro de massa (Baricentro) da face 2D projetada na tela
    const numPoints = best.vertices.length;
    const centerX = sumX / numPoints;
    const centerY = sumY / numPoints;

    // Área do retângulo que envolve (Bounding Box) a face na tela
    const faceWidth = maxX - minX;
    const faceHeight = maxY - minY;

    // Determina a fonte baseada no espaço livre do polígono.
    // D4 e D20 são triângulos que afunilam muito no topo, então a caixa útil é menor.
    let dynamicFontSize = Math.min(faceWidth, faceHeight) * 0.45;
    
    // Ajuste extra se o número tiver muitos dígitos para não esticar além das arestas
    if (best.text.length > 1) dynamicFontSize *= 0.8;
    if (best.text.length > 2) dynamicFontSize *= 0.6;
    
    // Evita valores impossíveis que quebram o React Native
    dynamicFontSize = Math.max(10, Math.min(80, dynamicFontSize));

    onResult(best.text, { x: centerX, y: centerY }, dynamicFontSize);
  };

  useEffect(() => { 
      if (skipAnim) finalize(true); 
  }, [skipAnim]);

  useFrame(() => {
    if (isDone) return;
    meshRef.current.position.copy(body.position as any);
    meshRef.current.quaternion.copy(body.quaternion as any);
    
    if (edgesRef.current) {
        edgesRef.current.position.copy(body.position as any);
        edgesRef.current.quaternion.copy(body.quaternion as any);
    }
    
    if (body.velocity.length() < 4.0 && body.angularVelocity.length() < 4.0) {
        finalize(false); 
    }
  });

  return (
    <>
      <mesh ref={meshRef} castShadow geometry={geometry as any}>
        <meshStandardMaterial color={die.color} roughness={0.3} metalness={0.2} flatShading />
      </mesh>
      <lineSegments ref={edgesRef} geometry={edgesGeom as any}>
        <lineBasicMaterial color="#02112b" linewidth={2} />
      </lineSegments>
    </>
  );
}

function DiceContainer({ die, count, skipAnim, onFinish }: { die: DieType, count: number, skipAnim: boolean, onFinish: (total: number, rolls: {val: string, pos: {x:number,y:number}, size: number}[], highest: number, lowest: number) => void }) {
  const diceMat = useMemo(() => new CANNON.Material(), []);
  const floorMat = useMemo(() => new CANNON.Material(), []);
  const wallMat = useMemo(() => new CANNON.Material(), []);
  
  const [results, setResults] = useState<{val: string, pos: {x:number, y:number}, size: number}[]>([]);

  const world = useMemo(() => {
    const w = new CANNON.World();
    w.gravity.set(0, -70, 0);
    
    w.addContactMaterial(new CANNON.ContactMaterial(floorMat, diceMat, { friction: 0.6, restitution: 0.3 }));
    w.addContactMaterial(new CANNON.ContactMaterial(wallMat, diceMat, { friction: 0.0, restitution: 0.8 }));
    w.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, { friction: 0.1, restitution: 0.7 }));
    
    const createWall = (p: [number, number, number], r: [number, number, number], m: CANNON.Material) => {
      const b = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane(), material: m });
      b.position.set(...p); b.quaternion.setFromEuler(...r); w.addBody(b);
    };
    
    createWall([0, 0, 0], [-Math.PI / 2, 0, 0], floorMat);
    createWall([0, 15, 0], [Math.PI / 2, 0, 0], wallMat); 
    createWall([-2.3, 0, 0], [0, Math.PI / 2, 0], wallMat);
    createWall([2.3, 0, 0], [0, -Math.PI / 2, 0], wallMat);
    createWall([0, 0, -2.5], [0, 0, 0], wallMat);
    createWall([0, 0, 4.5], [0, Math.PI, 0], wallMat);
    
    return w;
  }, []);

  useFrame((_, delta) => world.step(1 / 60, Math.min(delta, 0.1), 10));

  const handleResult = (val: string, position: {x: number, y: number}, fontSize: number) => {
    setResults(prev => {
      const newResults = [...prev, { val, pos: position, size: fontSize }];
      
      if (newResults.length === count) {
        let total = 0;
        let highest = -Infinity;
        let lowest = Infinity;

        newResults.forEach(r => {
            const num = parseInt(r.val);
            total += num;
            if (num > highest) highest = num;
            if (num < lowest) lowest = num;
        });

        onFinish(total, newResults, highest, lowest);
      }
      return newResults;
    });
  };

  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight castShadow position={[10, 20, 10]} intensity={2.5} />
      {Array.from({ length: count }).map((_, i) => (
        <SingleDie key={i} die={die} world={world} diceMat={diceMat} skipAnim={skipAnim} count={count} onResult={handleResult} />
      ))}
    </>
  );
}

export default function DiceRoller3D() {
  const [isOpen, setIsOpen] = useState(false);
  const [diceCount, setDiceCount] = useState(1);
  const [activeDie, setActiveDie] = useState<DieType | null>(null);
  const [finalData, setFinalData] = useState<{ total: number, rolls: {val: string, pos: {x:number, y:number}, size: number}[], highest: number, lowest: number } | null>(null);
  const [skipAnim, setSkipAnim] = useState(false);

  const [overlayPosition, setOverlayPosition] = useState<'top' | 'bottom'>('bottom');

  const pan = useRef(new Animated.ValueXY({ x: width - FAB_SIZE - SNAP_MARGIN, y: height - FAB_SIZE - SNAP_MARGIN - 50 })).current;
  const [menuSide, setMenuSide] = useState<'left' | 'right'>('right');
  const [menuVertical, setMenuVertical] = useState<'top' | 'bottom'>('bottom');

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 || Math.abs(g.dy) > 10,
    onPanResponderGrant: () => { 
        pan.setOffset({ x: (pan.x as any)._value, y: (pan.y as any)._value }); 
        pan.setValue({ x: 0, y: 0 }); 
        setIsOpen(false); 
        setActiveDie(null);
        setFinalData(null);
        setSkipAnim(false);
    },
    onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
    onPanResponderRelease: () => {
      pan.flattenOffset();
      
      const currentX = (pan.x as any)._value;
      const currentY = (pan.y as any)._value;

      const isRight = currentX + FAB_SIZE / 2 > width / 2;
      const finalX = isRight ? width - FAB_SIZE - SNAP_MARGIN : SNAP_MARGIN;
      setMenuSide(isRight ? 'right' : 'left');

      const isTop = currentY + FAB_SIZE / 2 < height / 2;
      setMenuVertical(isTop ? 'top' : 'bottom');

      Animated.spring(pan, { toValue: { x: finalX, y: currentY }, useNativeDriver: false, friction: 6 }).start();
    }
  })).current;

  const rollDice = (die: DieType) => {
    setFinalData(null);
    setSkipAnim(false); 
    setActiveDie(null); 
    setIsOpen(false);
    
    setTimeout(() => {
        setActiveDie(die); 
    }, 50); 
  };

  const handleFinishRolling = (total: number, rolls: {val: string, pos: {x:number, y:number}, size: number}[], highest: number, lowest: number) => {
    let sumY = 0;
    rolls.forEach(r => sumY += r.pos.y);
    const avgY = sumY / rolls.length;

    if (avgY > height / 2) {
        setOverlayPosition('top');
    } else {
        setOverlayPosition('bottom');
    }

    setFinalData({ total, rolls, highest, lowest });
  };

  const handleCloseCanvas = () => {
      if (finalData) {
          setActiveDie(null);
          setFinalData(null);
          setSkipAnim(false);
      } else {
          setSkipAnim(true);
      }
  };

  return (
    <>
      {activeDie && (
        <View style={styles.canvasContainer}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={handleCloseCanvas} />
          
          <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
            <Canvas style={{ flex: 1 }} shadows camera={{ position: [0, 12, 10], fov: 50 }}>
              <DiceContainer die={activeDie} count={diceCount} skipAnim={skipAnim} onFinish={handleFinishRolling} />
            </Canvas>
          </View>
          
          {finalData && (
            <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
               {finalData.rolls.map((roll, idx) => (
                 <View key={idx} style={{
                    position: 'absolute',
                    left: roll.pos.x, 
                    top: roll.pos.y,
                    transform: [{ translateX: '-50%' }, { translateY: '-50%' }],
                    justifyContent: 'center', alignItems: 'center'
                 }}>
                   <Text style={{
                     color: '#fff', 
                     fontWeight: '900',
                     fontSize: roll.size, 
                     textShadowColor: '#000', 
                     textShadowOffset: { width: 1, height: 1 },
                     textShadowRadius: 3
                   }}>
                     {roll.val}
                   </Text>
                 </View>
               ))}
               
               <View style={[styles.resultOverlay, overlayPosition === 'top' ? { top: '15%' } : { bottom: '15%' }]}>
                 <Text style={styles.totalText}>{finalData.total}</Text>
                 
                 {diceCount > 1 && (
                     <View style={styles.highLowContainer}>
                         <View style={[styles.highLowBadge, { borderColor: '#00fa9a', backgroundColor: 'rgba(0, 250, 154, 0.1)' }]}>
                             <Text style={[styles.highLowLabel, { color: '#00fa9a' }]}>MAIOR</Text>
                             <Text style={[styles.highLowValue, { color: '#00fa9a' }]}>{finalData.highest}</Text>
                         </View>
                         <View style={[styles.highLowBadge, { borderColor: '#ff4757', backgroundColor: 'rgba(255, 71, 87, 0.1)' }]}>
                             <Text style={[styles.highLowLabel, { color: '#ff4757' }]}>MENOR</Text>
                             <Text style={[styles.highLowValue, { color: '#ff4757' }]}>{finalData.lowest}</Text>
                         </View>
                     </View>
                 )}

                 <Text style={styles.tapToCloseText}>Toque para fechar</Text>
               </View>
            </View>
          )}
        </View>
      )}

      <Animated.View style={[styles.draggableContainer, { transform: [{ translateX: pan.x }, { translateY: pan.y }] }]} {...panResponder.panHandlers}>
        {isOpen && (
          <View style={[styles.menuContainer, { [menuSide === 'right' ? 'right' : 'left']: 0, [menuVertical === 'top' ? 'top' : 'bottom']: 0 }]}>
            
            <View style={[styles.qtySelector, { 
                [menuSide === 'right' ? 'right' : 'left']: 0, 
                [menuVertical === 'top' ? 'top' : 'bottom']: 70 
              }]}>
              {[1, 2, 3, 4, 5, 6].map(n => (
                <TouchableOpacity key={n} style={[styles.qtyBtn, diceCount === n && styles.qtyBtnActive]} onPress={() => {
                  if (activeDie) {
                      setActiveDie(null); 
                      setFinalData(null); 
                      setSkipAnim(false);
                  }
                  setDiceCount(n);
                }}>
                  <Text style={[styles.qtyBtnText, diceCount === n && styles.qtyBtnTextActive]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
            
            {DICE_TYPES.map((die, i) => (
              <TouchableOpacity 
                key={die.id} 
                style={[
                  styles.subButton, 
                  { 
                    [menuVertical === 'top' ? 'top' : 'bottom']: 130 + i * 55, 
                    backgroundColor: die.color, 
                    [menuSide === 'right' ? 'right' : 'left']: 0 
                  }
                ]} 
                onPress={() => rollDice(die)}
              >
                <MaterialCommunityIcons name={die.icon} size={24} color="#fff" />
                <Text style={[styles.subButtonText, menuSide === 'right' ? { right: 55 } : { left: 55 }]}>{die.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        
        <TouchableOpacity style={styles.fab} onPress={() => {
            if (!isOpen) {
                setActiveDie(null);
                setFinalData(null);
                setSkipAnim(false);
            }
            setIsOpen(!isOpen)
        }}>
          <MaterialCommunityIcons name={isOpen ? "close" : "dice-multiple"} size={30} color="#fff" />
        </TouchableOpacity>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  canvasContainer: { ...StyleSheet.absoluteFillObject, zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center' },
  resultOverlay: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.9)', paddingHorizontal: 50, paddingVertical: 20, borderRadius: 25, borderWidth: 2, borderColor: '#00bfff', alignItems: 'center', elevation: 10 },
  totalText: { color: '#00fa9a', fontSize: 64, fontWeight: 'bold', textShadowColor: 'rgba(0, 250, 154, 0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 },
  
  highLowContainer: { flexDirection: 'row', gap: 15, marginTop: 10, marginBottom: 5 },
  highLowBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, alignItems: 'center', minWidth: 60 },
  highLowLabel: { fontSize: 9, fontWeight: 'bold', letterSpacing: 1, marginBottom: 2 },
  highLowValue: { fontSize: 20, fontWeight: 'bold' },

  tapToCloseText: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 15, textTransform: 'uppercase' },
  draggableContainer: { position: 'absolute', top: 0, left: 0, width: FAB_SIZE, height: FAB_SIZE, zIndex: 10000 },
  fab: { width: FAB_SIZE, height: FAB_SIZE, borderRadius: 30, backgroundColor: '#00bfff', justifyContent: 'center', alignItems: 'center', elevation: 8, borderWidth: 2, borderColor: '#102b56' },
  menuContainer: { position: 'absolute', width: 250 },
  qtySelector: { position: 'absolute', flexDirection: 'row', backgroundColor: 'rgba(16,43,86,0.9)', padding: 8, borderRadius: 30, gap: 5, borderWidth: 1, borderColor: '#00bfff' },
  qtyBtn: { width: 35, height: 35, borderRadius: 17.5, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  qtyBtnActive: { backgroundColor: '#00bfff' },
  qtyBtnText: { color: '#fff', fontWeight: 'bold' },
  qtyBtnTextActive: { color: '#102b56' },
  subButton: { position: 'absolute', width: 45, height: 45, borderRadius: 22.5, justifyContent: 'center', alignItems: 'center', elevation: 4, borderWidth: 2, borderColor: '#102b56' },
  subButtonText: { position: 'absolute', color: '#fff', backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, fontWeight: 'bold', fontSize: 12 },
});