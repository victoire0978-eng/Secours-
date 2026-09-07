# Validation iOS hors-ligne NLSbox

Ce protocole doit être exécuté sur un iPhone ou un iPad réel avec Safari, après
avoir enregistré au moins un fichier de chaque catégorie dans NLSbox.

## Préparation

1. Ouvrir NLSbox dans Safari.
2. Ajouter NLSbox à l’écran d’accueil si l’application est utilisée comme PWA.
3. Télécharger les fichiers suivants dans le stockage hors-ligne :
   - une vidéo MP4 ou MOV encodée H.264/AAC ;
   - un fichier audio MP3 ou M4A ;
   - un fichier TXT, EPUB et DOCX ;
   - une image ;
   - une archive CBZ ou ZIP contenant des images ;
   - si disponibles, un MKV, CBR/RAR et 7z.
4. Ouvrir chaque fichier une fois avec une connexion active afin de vérifier
   qu’il apparaît dans l’onglet **Hors-ligne**.
5. Activer le mode avion et fermer Safari avant de rouvrir NLSbox.

## Résultats attendus

| Format | Résultat attendu sans réseau |
| --- | --- |
| MP4 / MOV / M4V compatible | Lecture dans le lecteur NLSbox |
| MP3 / M4A / AAC / WAV compatible | Lecture dans le lecteur audio NLSbox |
| TXT | Texte visible dans NLSbox |
| EPUB | Chapitres et images visibles dans NLSbox |
| DOCX | Texte visible dans NLSbox |
| PDF | Affichage local Safari ou ouverture via **Ouvrir** |
| Image | Visionneuse locale NLSbox |
| CBZ / ZIP | Planches extraites et lisibles dans NLSbox |
| MKV / AVI / FLV / WMV | Message de format non décodable + bouton **Ouvrir** |
| CBR / RAR / 7z | Message de format non extractible + bouton **Ouvrir** |

Pour les formats non décodables par Safari, **Ouvrir** doit afficher la feuille
de partage iOS avec le fichier réel, afin de le remettre à VLC, Infuse,
Panels, Chunky ou une autre application installée.

## Contrôles de régression

- Fermer chaque lecteur puis rouvrir un autre fichier : aucun ancien média ne
  doit rester affiché.
- Revenir dans l’onglet Hors-ligne après un redémarrage de Safari : les fichiers
  doivent rester listés.
- Vérifier qu’aucune requête réseau n’est nécessaire en mode avion.
- Vérifier que les boutons VLC et Android restent inchangés sur Android.