---
name: Lecture média iOS hors-ligne
description: Contrainte durable des lecteurs locaux Safari iOS et stratégie de secours de NLSbox.
---

Safari iOS ne fournit pas de décodeur web universel : la lecture intégrée doit passer par les formats que l’élément audio/vidéo déclare compatibles. Les fichiers comme MKV, AVI, FLV, WMV, CBR/RAR et 7z doivent être remis au système via partage de fichier pour VLC, Infuse, Panels, Chunky ou une application équivalente.

**Why:** Une PWA ne peut pas installer de codec natif ni lancer directement une application iOS comme un intent Android.

**How to apply:** Toujours utiliser le Blob OPFS pour les fichiers hors-ligne iOS; tester `canPlayType` avant d’afficher un lecteur média intégré; pour les formats non décodables, utiliser `navigator.share({ files })` plutôt qu’une URL réseau ou un nouvel onglet.