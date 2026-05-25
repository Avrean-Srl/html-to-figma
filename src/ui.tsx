import {
  Container,
  render,
  Text,
  VerticalSpace
} from '@create-figma-plugin/ui'
import { h } from 'preact'

function Plugin() {
  return (
    <Container space="medium">
      <VerticalSpace space="large" />
      <Text>
        <strong>HTML to Figma</strong>
      </Text>
      <VerticalSpace space="small" />
      <Text>Phase 0 scaffold OK. Parser + mapper coming in Phase 1.</Text>
      <VerticalSpace space="large" />
    </Container>
  )
}

export default render(Plugin)
