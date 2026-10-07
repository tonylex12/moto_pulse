import React from 'react';
import { Text, TextInput, TextInputProps, TextProps } from 'react-native';

export function MPText({ style, ...props }: TextProps) {
  return <Text {...props} style={[{ fontFamily: 'Barlow' }, style]} />;
}

export function MPTextInput({ style, ...props }: TextInputProps) {
  return <TextInput {...props} style={[{ fontFamily: 'Barlow' }, style]} />;
}
