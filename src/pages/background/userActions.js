import { saveSuccess } from './postSave'
import * as Sentry from '@sentry/browser'

import { isSystemPage, isSystemLink } from 'common/helpers'
import { getSetting, setSettings } from 'common/interface'
import { closeLoginPage } from 'common/helpers'
import { setToolbarIcon } from 'common/interface'
import { localize } from 'common/locales'

import { authorize } from 'common/api'
import { getGuid } from 'common/api'
import { saveToPocket } from 'common/api'
import { syncItemTags } from 'common/api'
import { removeItem } from 'common/api'

import {
  AUTH_URL,
  LOGOUT_URL,
  POCKET_HOME,
  POCKET_LIST,
} from 'common/constants'

import { SAVE_TO_POCKET_REQUEST } from 'actions'
import { SAVE_TO_POCKET_SUCCESS } from 'actions'
import { SAVE_TO_POCKET_FAILURE } from 'actions'

import { TAG_SYNC_REQUEST } from 'actions'
import { TAG_SYNC_SUCCESS } from 'actions'
import { TAG_SYNC_FAILURE } from 'actions'

import { REMOVE_ITEM_REQUEST } from 'actions'
import { REMOVE_ITEM_SUCCESS } from 'actions'
import { REMOVE_ITEM_FAILURE } from 'actions'

import { UPDATE_TAG_ERROR } from 'actions'

var postAuthSave = null

/* Browser Action - Toolbar Icon Clicked
–––––––––––––––––––––––––––––––––––––––––––––––––– */
export function browserAction(tab) {
  if (isSystemPage(tab)) return openPocketHome() // open list on non-standard pages

  const { id: tabId, title, url: pageUrl } = tab

  save({ pageUrl, title, tabId })
}

/* Context Clicks - Right/Option Click Menus
–––––––––––––––––––––––––––––––––––––––––––––––––– */
export function contextClick(info, tab) {
  const { menuItemId, linkUrl, pageUrl } = info
  const { id: tabId, title } = tab

  if (menuItemId === 'toolbarContextClickHome') return openPocketHome()
  if (menuItemId === 'toolbarContextClickList') return openPocketList()
  if (menuItemId === 'toolbarContextClickLogOut') return logOut()
  if (menuItemId === 'toolbarContextClickLogIn') return logIn()

  // Open list on non-standard pages/links
  if (isSystemLink(linkUrl || pageUrl)) return openPocketHome()

  return save({ linkUrl, pageUrl, title, tabId })
}

/* Saving
–––––––––––––––––––––––––––––––––––––––––––––––––– */
async function save({ linkUrl, pageUrl, title, tabId }) {
  // Are we authed?
  const access_token = await getSetting('access_token')
  if (!access_token) return logIn({ linkUrl, pageUrl, title, tabId })

  // send message that we are requesting a save
  chrome.tabs.sendMessage(tabId, { action: SAVE_TO_POCKET_REQUEST })

  const url = linkUrl || pageUrl

  try {
    const { response: payload } = await saveToPocket({ url, title, tabId })
    // send a message with the response
    const message = payload
      ? { action: SAVE_TO_POCKET_SUCCESS, payload }
      : { action: SAVE_TO_POCKET_FAILURE, payload }

    chrome.tabs.sendMessage(tabId, message)

    if (payload) saveSuccess(tabId, { ...payload, isLink: Boolean(linkUrl) })
  } catch (error) {
    // If it is an auth error let's redirect the user
    if (error?.xErrorCode === '107') {
      return logIn({ linkUrl, pageUrl, title, tabId })
    }

    // Otherwise let's just show the error message
    const errorMessage = { action: SAVE_TO_POCKET_FAILURE }
    chrome.tabs.sendMessage(tabId, errorMessage)
  }
}

/* Remove item
–––––––––––––––––––––––––––––––––––––––––––––––––– */
export async function removeItemAction(tab, payload) {
  const { id: tabId } = tab
  const { itemId } = payload

  // send message that we are attempting to sync tags
  chrome.tabs.sendMessage(tabId, { action: REMOVE_ITEM_REQUEST })

  const { response } = await removeItem(itemId)
  const message = response
    ? { action: REMOVE_ITEM_SUCCESS, payload }
    : { action: REMOVE_ITEM_FAILURE, payload }

  chrome.tabs.sendMessage(tabId, message)

  if (response) setToolbarIcon(tabId, false)
}

/* Add tags to item
–––––––––––––––––––––––––––––––––––––––––––––––––– */
export async function tagsSyncAction(tab, payload) {
  const { id: tabId } = tab
  const { item_id, tags, ...actionInfo } = payload

  // send message that we are attempting to sync tags
  chrome.tabs.sendMessage(tabId, { action: TAG_SYNC_REQUEST })

  const { response } = await syncItemTags(item_id, tags, actionInfo)
  const message = response
    ? { action: TAG_SYNC_SUCCESS, payload }
    : { action: TAG_SYNC_FAILURE, payload }

  chrome.tabs.sendMessage(tabId, message)
}

/* Submit tags error
–––––––––––––––––––––––––––––––––––––––––––––––––– */
export async function tagsErrorAction(tab, payload) {
  const { id: tabId } = tab
  chrome.tabs.sendMessage(tabId, { action: UPDATE_TAG_ERROR, payload })
}

/* Authentication user
–––––––––––––––––––––––––––––––––––––––––––––––––– */
export async function authCodeRecieved(tab, payload) {
  // Getting a Guid to use in the request
  // Getting an auth token
  try {
    const guidResponse = await getGuid()
    const authResponse = await authorize(guidResponse, payload)
    const { access_token, account, username } = authResponse
    const { premium_status } = account
    setSettings({ access_token, premium_status, username })
  } catch (err) {
    Sentry.withScope((scope) => {
      scope.setFingerprint('Auth Error')
      Sentry.captureMessage(err)
    })
  }

  closeLoginPage()
  setContextMenus()

  if (postAuthSave) save(postAuthSave)
  postAuthSave = null
}

export function logOut() {
  chrome.tabs.create({ url: LOGOUT_URL })
}

export function loggedOutOfPocket() {
  chrome.storage.local.clear()
  setContextMenus()
}

export function logIn(saveObject) {
  postAuthSave = saveObject
  chrome.tabs.create({ url: AUTH_URL })
}

export function openPocket() {
  chrome.tabs.create({ url: POCKET_LIST })
}

export function openPocketList() {
  chrome.tabs.create({ url: POCKET_LIST })
}

export function openPocketHome() {
  chrome.tabs.create({ url: POCKET_HOME })
}

export function openOptionsPage() {
  chrome.runtime.openOptionsPage()
}

/* Tab Changes
–––––––––––––––––––––––––––––––––––––––––––––––––– */
export function tabUpdated(tabId, changeInfo) {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    // if actively loading a new page, unset save state on icon
    setToolbarIcon(tabId, false)
  }
}

/* Theme Changes
–––––––––––––––––––––––––––––––––––––––––––––––––– */
export async function setColorMode(tab, { theme }) {
  await setSettings({ theme })
}

/* Context Menus
–––––––––––––––––––––––––––––––––––––––––––––––––– */
export async function setContextMenus() {
  chrome.contextMenus.removeAll()

  // Page Context - Right click menu on page
  chrome.contextMenus.create({
    title: localize('context_menu_save'),
    id: 'pageContextClick',
    contexts: ['page', 'frame', 'editable', 'image', 'video', 'audio', 'link', 'selection'], // prettier-ignore
  })

  // Browser Icon - Right click menu
  chrome.contextMenus.create({
    title: localize('context_menu_open_list'),
    id: 'toolbarContextClickList',
    contexts: ['action'],
  })

  chrome.contextMenus.create({
    title: localize('context_menu_discover_more'),
    id: 'toolbarContextClickHome',
    contexts: ['action'],
  })

  // Log In or Out menu item depending on existence of access token
  const access_token = await getSetting('access_token')
  if (access_token) {
    chrome.contextMenus.create({
      title: localize('context_menu_log_out'),
      id: 'toolbarContextClickLogOut',
      contexts: ['action'],
    })
  } else {
    chrome.contextMenus.create({
      title: localize('context_menu_log_in'),
      id: 'toolbarContextClickLogIn',
      contexts: ['action'],
    })
  }
}
