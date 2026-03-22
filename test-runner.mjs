process.env.NODE_ENV = 'test'
import('./index.mjs')
.then(() => {
  console.log('index.mjs imported (test mode)')
}).catch(err => {
  console.error('Failed importing index.mjs in test-runner:', err)
  process.exit(1)
})
